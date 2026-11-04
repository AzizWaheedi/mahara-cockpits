# Team Calendar worker

Drains at most one verified Team Calendar operation per 10-minute Hermes cron tick (job `12a21a97f352`).
Healthy runs print nothing; a nonzero exit makes the scheduler post to Slack `#health`.
It loads key names from `/opt/data/bibi/api-keys.env` and never hardcodes a value.
Deploy by copying `worker.py` to `/opt/data/scripts/team-calendar-worker.py` on the VPS.
Bun must live at `/opt/data/bin/bun` and never in a package cache the cleanup may delete.
The 29 Oct to 1 Nov 2026 failures had three causes.
A disk cleanup deleted the Bun binary.
A duplicate root gateway ran the same jobs.
One database read failed and had no retry, which posted a false failure.
