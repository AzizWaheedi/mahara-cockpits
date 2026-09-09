# Cron job for Hermes

- Name: Cockpit Ask AI
- Schedule (UTC): */5 * * * *
- Prompt: "Load the cockpit-ask-ai skill and run it once. If both queues are empty, output nothing."
- Toolsets: terminal, execute_code, file read/write. Nothing else.
- Silent on empty output.
