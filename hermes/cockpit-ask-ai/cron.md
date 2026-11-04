# Cron job for Hermes

- Name: Cockpit Ask AI
- Schedule (UTC): */5 * * * *
- Prompt: "Load the cockpit-ask-ai skill and run it once. If both queues are empty, output nothing."
- Toolsets: terminal, execute_code, file read/write. Nothing else.
- Silent on empty output.

## Fast responder (hermes crontab, not a Hermes agent job)

```
* * * * * cd /home/hermes/cockpit-ask-ai-current && /usr/bin/flock -n -E 0 /home/hermes/.cockpit-ask-ai/lock /opt/hermes-host/venv/bin/python responder.py run --seconds 55 --apply >> /home/hermes/.cockpit-ask-ai/responder.log 2>&1 || echo "$(date -u +\%Y-\%m-\%dT\%H:\%M:\%SZ) FAIL cron wrapper exit $?" >> /home/hermes/.cockpit-ask-ai/responder.log
```

The Hermes agent job above stays as the fallback for chat and the only answerer for comment_digest and call_brief.
