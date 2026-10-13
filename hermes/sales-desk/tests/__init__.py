"""Every temp folder a test makes lands in one folder for the run, removed when the run ends.

The tests call tempfile.mkdtemp() for a desk home, an out folder or a work folder and
never remove them. Each engine test leaves about 1.5 MB of drafts behind, and on the
Mac they had filled the disk (16,886 folders, about 2 GB) until writes failed. Pointing
tempfile at a folder of our own, and removing it at exit, cleans up after every test
without touching each one.
"""

from __future__ import annotations

import atexit
import shutil
import tempfile

# Underscores, not hyphens: "desk-" holds "sk-", which the doctor tests read as a
# printed secret key wherever a path is said.
RUN_TMP = tempfile.mkdtemp(prefix="sales_desk_tests_")
tempfile.tempdir = RUN_TMP
atexit.register(shutil.rmtree, RUN_TMP, True)
