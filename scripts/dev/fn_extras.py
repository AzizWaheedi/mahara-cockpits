#!/usr/bin/env python3
"""List the files outside supabase/functions/<slug>/ that the function imports, transitively.
fn_extras.py <repo root> <slug>
Prints them space-separated, relative to the root, ready to pass to deploy_tree.py."""
import os, re, sys
root, slug = sys.argv[1], sys.argv[2]
base = os.path.normpath(os.path.join(root, "supabase", "functions", slug))
imp = re.compile(r"""(?:import|export)\s[^'"]*?from\s*['"](\.{1,2}/[^'"]+)['"]|import\s*\(\s*['"](\.{1,2}/[^'"]+)['"]""")
seen, extras, todo = set(), set(), []
for d, _, fs in os.walk(base):
    for f in fs:
        if f.endswith(".ts") and not f.endswith(".test.ts"):
            todo.append(os.path.normpath(os.path.join(d, f)))
while todo:
    p = todo.pop()
    if p in seen or not os.path.exists(p):
        continue
    seen.add(p)
    if not p.startswith(base + os.sep):
        extras.add(os.path.relpath(p, root).replace(os.sep, "/"))
    for m in imp.finditer(open(p, encoding="utf-8").read()):
        rel = m.group(1) or m.group(2)
        todo.append(os.path.normpath(os.path.join(os.path.dirname(p), rel)))
print(" ".join(sorted(extras)))
