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

## Merge Queue Risk Taxonomy

Merge queue outputs now include deterministic risk metadata in `merge_queue.risk_snapshot`:

- `scoringVersion`: stable risk model version (`merge-risk-v1`)
- `riskTable[]`:
  - `ticketId`
  - `overlapCount`
  - `churnScore`
  - `historicalEvictions`
  - `dependencyProximity`
  - `riskScore` (0-100)
  - `riskBand` (`low`, `medium`, `high`)
  - `mergeStrategy` (`speculative`, `sequential`)
- `recommendedOrder[]`: deterministic sorted order with rank and batch assignment
- `speculativeBatches[][]`: speculative batch boundaries
- `sequentialTickets[]`: tickets forced into sequential strategy

This snapshot is emitted every merge-queue iteration and should be used for:
- eviction-rate analysis by risk band
- first-pass land-rate tracking by strategy
- drift detection when tuning risk weights/thresholds

## Operational Usage

- Tail events during execution:
  - `tail -f .agentix/events.jsonl`
- Filter failed commands:
  - `rg '"event":"command.failed"' .agentix/events.jsonl`
- Correlate run failures:
  - `rg '"runId":"sw-' .agentix/events.jsonl`

This file is local runtime telemetry and should not be committed.
