# Offline New Client link reconciliation

This is an isolated, non-networked helper for one card. It does not call Make,
ClickUp, Drive, WhatsApp or any other provider. It cannot send messages,
invite anyone, resume an incomplete execution, create files in Drive, or apply
the proposed changes. It does not make a repair race-free: ClickUp's exposed
update operation has no compare-and-set condition. The operator remains
responsible for coordination and the final provider action.

## Evidence and boundaries

The New Client Make flow returns the client folder, offer document, Brand DNA
document and reporting sheet and maps them to four URL fields on the ClickUp
client card. The original execution must independently identify that task. A
resumed branch may send messages or invitations. Do not resolve, retry, or
replay a branch as a way to repair the links.

Read the exact current Make execution, card, field definitions and Drive
metadata before preparing a snapshot. They are client data: keep snapshots
and plans in an access-restricted location outside every public repository;
do not attach them to issues, commits, logs or chat. The Make execution ID
and task ID must refer to the same original execution. Capture the successful
source output and the original task ID, not names or fuzzy matches. This helper
cannot independently establish that the supplied evidence is genuine.

## Snapshot format

Create a private JSON file containing the following, with actual private values
supplied locally. JSON keys are exact and no messages or client details should
be printed. Use the complete current ClickUp task response, including all
custom fields and `date_updated`. Confirm completeness separately before
setting `complete_task_fields` to `true`; a partial response is not evidence
that a value is absent.

```json
{
  "complete_task_fields": true,
  "source_task_id": "task-id-from-original-execution",
  "source_execution_id": "32-hex-character-original-execution-id",
  "task": {"id": "same-task-id", "date_updated": "unix-milliseconds", "custom_fields": []},
  "make_output": {"success": true, "folderLink": "...", "offerLink": "...", "brandDnaLink": "...", "reportLink": "..."},
  "field_schema": {
    "folderLink": {"id": "folder-field-id", "type": "url"},
    "offerLink": {"id": "offer-field-id", "type": "url"},
    "brandDnaLink": {"id": "dna-field-id", "type": "url"},
    "reportLink": {"id": "report-field-id", "type": "url"}
  },
  "drive_metadata": {
    "folderLink": {"id": "...", "mimeType": "application/vnd.google-apps.folder", "trashed": false, "parents": []},
    "offerLink": {"id": "...", "mimeType": "application/vnd.google-apps.document", "trashed": false, "parents": ["folder-id"]},
    "brandDnaLink": {"id": "...", "mimeType": "application/vnd.google-apps.document", "trashed": false, "parents": ["folder-id"]},
    "reportLink": {"id": "...", "mimeType": "application/vnd.google-apps.spreadsheet", "trashed": false, "parents": ["folder-id"]}
  }
}
```

The schema object must contain all four IDs from the current client list
definitions, independently verified against the original workflow mapping and
as `url` fields. The helper accepts the operator's mapping and cannot prove it
is correct, so wrong IDs can generate a misleading plan. Metadata must be a
current provider read, including explicit trash state, and each document and
sheet must still be in the confirmed folder. A connector response omitting
`trashed` does not establish `false`: obtain that field from Drive rather than
inventing it. Never copy real inputs into the example or test fixtures.

## Dry run and later operator use

1. Run `python3 reconcile_links.py plan PRIVATE_SNAPSHOT.json`. The report
   lists only the names of missing fields; it does not print task IDs, URLs,
   or client names. A conflict, incomplete input or mismatched Drive metadata
   stops the process without producing a plan.
2. If the reviewer needs an exact plan, run the same command with
   `--save-plan PRIVATE_PLAN.json`. This creates one new mode-0600 file and
   refuses to overwrite an existing file or save inside a Git repository. It
   contains the actual URLs and field IDs.
3. Coordinate with the workflow owner to prevent a concurrent write. Obtain a
   fresh complete task response as another private JSON file. Run
   `python3 reconcile_links.py before PRIVATE_PLAN.json FRESH_TASK.json`.
   A change to the task revision or any of the four fields requires a new plan.
4. The tool stops there. If the owner proceeds separately, apply **only** the
   still-missing fields listed in `changes`, without touching other fields.
   This is inherently non-atomic: another change could occur after the check.
   Do not describe this as compare-and-set; stop if coordination is uncertain.
5. Immediately read back the complete card again and run
   `python3 reconcile_links.py after PRIVATE_PLAN.json AFTER_TASK.json`.
   A mismatch must be investigated, not retried blindly. A successful check
   establishes the four values only, not that unrelated fields were unchanged.

Synthetic tests: `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest -v test_reconcile_links`.
