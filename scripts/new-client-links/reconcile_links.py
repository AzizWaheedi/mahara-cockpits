#!/usr/bin/env python3
"""Offline reconciliation of the four final New Client card links.

No network, credentials, provider writes, workflow execution or messaging.
Snapshots and plans contain client data: keep them outside the repository.
"""
import argparse
import json
import os
import re
import sys
from urllib.parse import urlsplit

FIELDS = {
    "folderLink": "application/vnd.google-apps.folder",
    "offerLink": "application/vnd.google-apps.document",
    "brandDnaLink": "application/vnd.google-apps.document",
    "reportLink": "application/vnd.google-apps.spreadsheet",
}
TASK_ID = re.compile(r"^[A-Za-z0-9]+$")
FILE_ID = re.compile(r"^[A-Za-z0-9_-]+$")


class Refusal(ValueError):
    pass


def verified_fields(schema):
    if not isinstance(schema, dict) or set(schema) != set(FIELDS):
        raise Refusal("The four ClickUp URL field definitions are not confirmed")
    ids = {}
    for name in FIELDS:
        definition = schema[name]
        if not isinstance(definition, dict) or definition.get("type") != "url" or not re.fullmatch(r"[A-Za-z0-9_-]+", str(definition.get("id", ""))):
            raise Refusal("Invalid URL field definition: " + name)
        ids[name] = definition["id"]
    if len(set(ids.values())) != len(ids):
        raise Refusal("URL field IDs must be distinct")
    return ids


def card_fields(task, ids):
    if not isinstance(task, dict) or not TASK_ID.fullmatch(str(task.get("id", ""))):
        raise Refusal("Invalid or missing task id")
    if not isinstance(task.get("date_updated"), (str, int)) or not str(task["date_updated"]).isdigit():
        raise Refusal("Missing task revision")
    fields = task.get("custom_fields")
    if not isinstance(fields, list):
        raise Refusal("Missing complete task custom fields")
    values = {}
    for field in fields:
        if not isinstance(field, dict) or not isinstance(field.get("id"), str):
            raise Refusal("Invalid task custom field")
        if field["id"] in values:
            raise Refusal("Duplicate task field")
        value = field.get("value")
        if field["id"] in ids.values() and value is not None and not isinstance(value, str):
            raise Refusal("Unexpected custom field value type")
        values[field["id"]] = value or None
    # An omitted field may be inapplicable, not empty. Require each target
    # field object to be present even when its value is null or omitted.
    if any(field_id not in values for field_id in ids.values()):
        raise Refusal("A target custom field is missing from the task response")
    return {name: values[field_id] for name, field_id in ids.items()}


def file_id(link, name):
    if not isinstance(link, str):
        raise Refusal("Missing source link: " + name)
    parts = urlsplit(link)
    if parts.scheme != "https" or parts.username or parts.password or parts.port:
        raise Refusal("Invalid source link: " + name)
    hosts = {"folderLink": "drive.google.com", "offerLink": "docs.google.com", "brandDnaLink": "docs.google.com", "reportLink": "docs.google.com"}
    prefixes = {"folderLink": "/drive/folders/", "offerLink": "/document/d/", "brandDnaLink": "/document/d/", "reportLink": "/spreadsheets/d/"}
    if parts.hostname != hosts[name] or not parts.path.startswith(prefixes[name]):
        raise Refusal("Unexpected source link host or kind: " + name)
    identifier = parts.path[len(prefixes[name]):].split("/", 1)[0]
    if not FILE_ID.fullmatch(identifier):
        raise Refusal("Invalid source file id: " + name)
    return identifier


def create_plan(snapshot):
    if not isinstance(snapshot, dict) or snapshot.get("complete_task_fields") is not True:
        raise Refusal("Confirm task snapshot contains the complete custom-fields response")
    task, source, files = snapshot.get("task"), snapshot.get("make_output"), snapshot.get("drive_metadata")
    schema = snapshot.get("field_schema")
    ids_by_name = verified_fields(schema)
    current = card_fields(task, ids_by_name)
    if snapshot.get("source_task_id") != task["id"] or not re.fullmatch(r"[a-f0-9]{32}", str(snapshot.get("source_execution_id", ""))):
        raise Refusal("Original execution must be tied to the same task")
    if not isinstance(source, dict) or source.get("success") is not True or not isinstance(files, dict):
        raise Refusal("Missing successful Make output or Drive metadata")
    ids = {name: file_id(source.get(name), name) for name in FIELDS}
    if len(set(ids.values())) != len(ids):
        raise Refusal("Source files must be distinct")
    for name, mime in FIELDS.items():
        f = files.get(name)
        if not isinstance(f, dict) or f.get("id") != ids[name] or f.get("mimeType") != mime or f.get("trashed") is not False:
            raise Refusal("Drive identity, type or trash state not confirmed: " + name)
        if name != "folderLink" and ids["folderLink"] not in f.get("parents", []):
            raise Refusal("File not confirmed in client folder: " + name)
    changes = {}
    for name in FIELDS:
        old, wanted = current[name], source[name]
        if old is None:
            changes[name] = wanted
        elif old != wanted:
            raise Refusal("Existing value differs; do not overwrite: " + name)
    return {"version": 1, "task_id": task["id"], "source_execution_id": snapshot["source_execution_id"], "date_updated": str(task["date_updated"]), "field_schema": schema,
            "before": current, "expected": {name: source[name] for name in FIELDS}, "changes": changes}


def check(plan, task, phase):
    if not isinstance(plan, dict) or plan.get("version") != 1 or not isinstance(task, dict) or task.get("id") != plan.get("task_id"):
        raise Refusal("Plan and task do not match")
    before, expected, changes = plan.get("before"), plan.get("expected"), plan.get("changes")
    if not all(isinstance(x, dict) for x in (before, expected, changes)) or set(before) != set(FIELDS) or set(expected) != set(FIELDS):
        raise Refusal("Plan fields are invalid")
    for name in FIELDS:
        file_id(expected[name], name)
        if before[name] not in (None, expected[name]):
            raise Refusal("Plan would overwrite a different value")
    if changes != {name: expected[name] for name in FIELDS if before[name] is None}:
        raise Refusal("Plan changes are inconsistent")
    actual = card_fields(task, verified_fields(plan.get("field_schema")))
    if phase == "before":
        if str(task["date_updated"]) != plan.get("date_updated") or actual != plan.get("before"):
            raise Refusal("Task changed since plan; make a new plan")
    elif phase == "after":
        if actual != plan.get("expected"):
            raise Refusal("Readback differs from expected; stop and investigate")
    else:
        raise Refusal("Unknown verification phase")
    return {"phase": phase, "verified": True, "fields_checked": len(FIELDS)}


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def private_write(path, data):
    # Never overwrite existing files or follow symlinks; plan contains real client URLs.
    parent = os.path.realpath(os.path.dirname(os.path.abspath(path)))
    tool_dir = os.path.realpath(os.path.dirname(__file__))
    if os.path.commonpath([parent, tool_dir]) == tool_dir:
        raise Refusal("Save the private plan outside the tool directory")
    cursor = parent
    while True:
        if os.path.exists(os.path.join(cursor, ".git")):
            raise Refusal("Save the private plan outside Git repositories")
        next_cursor = os.path.dirname(cursor)
        if next_cursor == cursor:
            break
        cursor = next_cursor
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
        f.write("\n")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("plan", help="offline dry run, optionally save a private plan")
    p.add_argument("snapshot")
    p.add_argument("--save-plan", metavar="PRIVATE_PATH")
    for cmd in ("before", "after"):
        p = sub.add_parser(cmd, help="compare a fresh task snapshot with a private plan")
        p.add_argument("plan")
        p.add_argument("task")
    args = parser.parse_args(argv)
    try:
        if args.command == "plan":
            plan = create_plan(load(args.snapshot))
            if args.save_plan:
                private_write(args.save_plan, plan)
            result = {"dry_run": True, "provider_writes": 0, "missing_fields": list(plan["changes"]),
                      "already_matching": len(FIELDS) - len(plan["changes"]), "private_plan_saved": bool(args.save_plan)}
        else:
            result = check(load(args.plan), load(args.task), args.command)
        print(json.dumps(result))
        return 0
    except (Refusal, OSError, ValueError, KeyError, TypeError) as exc:
        # Do not echo source contents or network error bodies.
        print("Refused: " + (str(exc) if isinstance(exc, Refusal) else type(exc).__name__), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
