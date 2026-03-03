# Observability

Agentix emits structured command lifecycle events to:

- `.agentix/events.jsonl`

Each line is a JSON object.

## Event Schema

```json
{
  "ts": "2026-03-03T12:00:00.000Z",
  "level": "info",
  "event": "command.started",
  "command": "run",
  "runId": "sw-abc123-89ef0123",
  "details": {
    "repoRoot": "/path/to/repo"
  }
}
```

Fields:
- `ts`: ISO timestamp
- `level`: `info` or `error`
- `event`: lifecycle event (`command.started`, `command.completed`, `command.failed`, `command.cancelled`)
- `command`: one of `init`, `plan`, `run`, `status`, `monitor`
- `runId`: optional workflow run ID
- `details`: additional metadata for troubleshooting

## Operational Usage

- Tail events during execution:
  - `tail -f .agentix/events.jsonl`
- Filter failed commands:
  - `rg '"event":"command.failed"' .agentix/events.jsonl`
- Correlate run failures:
  - `rg '"runId":"sw-' .agentix/events.jsonl`

This file is local runtime telemetry and should not be committed.
