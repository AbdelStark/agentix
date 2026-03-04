export type ClaudeTelemetryParseInput = {
  runId: string;
  nodeId: string | null;
  iteration: number | null;
  attempt: number | null;
  timestampMs: number;
  rawLine: string;
};

export type NormalizedClaudeTelemetryEvent = {
  runId: string;
  nodeId: string | null;
  iteration: number | null;
  attempt: number | null;
  timestampMs: number;
  eventType: string;
  eventKey: string;
  toolName: string | null;
  tokenUsage: {
    input: number | null;
    output: number | null;
    total: number | null;
  };
  payload: Record<string, unknown>;
};

export type ClaudeTelemetryIngestResult = {
  events: NormalizedClaudeTelemetryEvent[];
  malformedLines: number;
};

const KNOWN_CLAUDE_TYPES = new Set([
  "message_start",
  "message_delta",
  "message_update",
  "message_end",
  "content_block_start",
  "content_block_delta",
  "content_block_stop",
  "turn_start",
  "turn_end",
  "response",
  "assistant_message",
  "tool_use",
  "tool_result",
  "extension_ui_request",
]);

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function extractToolName(payload: Record<string, unknown>): string | null {
  const direct = payload.tool_name ?? payload.toolName ?? payload.name;
  if (typeof direct === "string" && direct.trim()) return direct.trim();

  const assistantMessageEvent = payload.assistantMessageEvent;
  if (assistantMessageEvent && typeof assistantMessageEvent === "object") {
    const candidate = (assistantMessageEvent as Record<string, unknown>).name;
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }

  const message = payload.message;
  if (message && typeof message === "object") {
    const candidate = (message as Record<string, unknown>).name;
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }

  return null;
}

function looksLikeClaudeEvent(payload: Record<string, unknown>): boolean {
  const type = payload.type;
  if (typeof type === "string" && KNOWN_CLAUDE_TYPES.has(type)) return true;

  const providerHint = `${String(payload.provider ?? "")} ${String(payload.source ?? "")}`.toLowerCase();
  if (providerHint.includes("claude")) return true;

  const modelHint = String(payload.model ?? payload.modelId ?? "").toLowerCase();
  if (modelHint.includes("claude")) return true;

  if (
    payload.assistantMessageEvent &&
    typeof payload.assistantMessageEvent === "object" &&
    typeof (payload.assistantMessageEvent as Record<string, unknown>).type === "string"
  ) {
    return true;
  }

  return false;
}

function extractTokenUsage(payload: Record<string, unknown>) {
  const usage =
    payload.usage && typeof payload.usage === "object"
      ? (payload.usage as Record<string, unknown>)
      : payload.message && typeof payload.message === "object"
        ? (((payload.message as Record<string, unknown>).usage as Record<string, unknown>) ?? null)
        : null;

  const input = toFiniteNumber(
    usage?.input_tokens ?? usage?.inputTokens ?? usage?.prompt_tokens,
  );
  const output = toFiniteNumber(
    usage?.output_tokens ?? usage?.outputTokens ?? usage?.completion_tokens,
  );
  const total = toFiniteNumber(
    usage?.total_tokens ?? usage?.totalTokens,
  );

  return { input, output, total };
}

export function parseClaudeTelemetryEvent(
  input: ClaudeTelemetryParseInput,
): NormalizedClaudeTelemetryEvent | null {
  const line = input.rawLine.trim();
  if (!line.startsWith("{")) return null;

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }

  if (!looksLikeClaudeEvent(payload)) return null;

  const type = payload.type;
  const eventType = typeof type === "string" ? type : "claude.unknown";

  const eventIdRaw =
    payload.id ??
    payload.event_id ??
    payload.eventId ??
    (payload.message && typeof payload.message === "object"
      ? (payload.message as Record<string, unknown>).id
      : undefined) ??
    `${input.timestampMs}:${eventType}`;

  return {
    runId: input.runId,
    nodeId: input.nodeId,
    iteration: input.iteration,
    attempt: input.attempt,
    timestampMs: input.timestampMs,
    eventType,
    eventKey: `claude:${input.runId}:${input.nodeId ?? ""}:${String(eventIdRaw)}`,
    toolName: extractToolName(payload),
    tokenUsage: extractTokenUsage(payload),
    payload,
  };
}

export function parseClaudeTelemetryJsonLine(
  line: string,
): Record<string, unknown> | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function ingestClaudeTelemetryLines(
  input: Omit<ClaudeTelemetryParseInput, "rawLine"> & { lines: string[] },
): ClaudeTelemetryIngestResult {
  const events: NormalizedClaudeTelemetryEvent[] = [];
  let malformedLines = 0;

  for (const line of input.lines ?? []) {
    const parsed = parseClaudeTelemetryJsonLine(line);
    if (!parsed) {
      malformedLines += 1;
      continue;
    }

    const event = parseClaudeTelemetryEvent({
      ...input,
      rawLine: JSON.stringify(parsed),
    });
    if (event) events.push(event);
  }

  return { events, malformedLines };
}
