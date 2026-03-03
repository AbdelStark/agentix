# Observability

Agentix emits structured command lifecycle events to:

- `.agentix/events.jsonl`

Each line is a JSON object.

## Event Schema

```json
{
  "schemaVersion": 2,
  "ts": "2026-03-03T12:00:00.000Z",
  "level": "info",
  "event": "command.started",
  "command": "run",
  "runId": "sw-abc123-89ef0123",
  "sessionId": "analytics-m7e3c4-a1b2c3d4",
  "unitId": "unit-42",
  "details": {
    "repoRoot": "/path/to/repo"
  }
}
```

Fields:
- `schemaVersion`: telemetry schema version (current: `2`, missing implies legacy `1`)
- `ts`: ISO timestamp
- `level`: `info` or `error`
- `event`: lifecycle event (`command.started`, `command.completed`, `command.failed`, `command.cancelled`)
- `command`: one of `init`, `plan`, `run`, `status`, `monitor`, `analytics`
- `runId`: optional workflow run ID
- `sessionId`: optional command invocation correlation ID
- `unitId`: optional work-unit correlation ID
- `details`: additional metadata for troubleshooting

Reason enums should be emitted under `details.reason` when a deterministic reason is known.

## Telemetry Analytics

Agentix now ships local analytics commands over `.agentix/events.jsonl`:

- `agentix analytics summary --window 7d`
- `agentix analytics summary --window 7d --json --write-report`
- `agentix analytics failures --window 7d --top 10`
- `agentix analytics failures --window 7d --top 10 --json`

Generated artifacts:
- `.agentix/analytics/daily-YYYY-MM-DD.json` (daily rollup snapshot)
- `docs/ops/quality-report.md` (actionable feedback report when `--write-report` is used)

Failure taxonomy buckets:
- `config`, `environment`, `schema`, `tests`, `merge`, `policy`, `infra`, `unknown`

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
