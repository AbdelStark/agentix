export type CodexTelemetryParseInput = {
  runId: string;
  nodeId: string | null;
  iteration: number | null;
  attempt: number | null;
  timestampMs: number;
  rawLine: string;
};

export type NormalizedCodexTelemetryEvent = {
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

export type CodexTelemetryIngestResult = {
  events: NormalizedCodexTelemetryEvent[];
  malformedLines: number;
};

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function extractTokenUsage(payload: Record<string, unknown>) {
  const usage =
    payload.usage && typeof payload.usage === "object"
      ? (payload.usage as Record<string, unknown>)
      : null;

  const input = toFiniteNumber(
    usage?.input_tokens ??
      usage?.inputTokens ??
      usage?.prompt_tokens ??
      payload.input_tokens ??
      payload.inputTokens,
  );

  const output = toFiniteNumber(
    usage?.output_tokens ??
      usage?.outputTokens ??
      usage?.completion_tokens ??
      payload.output_tokens ??
      payload.outputTokens,
  );

  const total = toFiniteNumber(
    usage?.total_tokens ??
      usage?.totalTokens ??
      payload.total_tokens ??
      payload.totalTokens,
  );

  return { input, output, total };
}

function extractToolName(payload: Record<string, unknown>): string | null {
  const direct = payload.tool_name ?? payload.toolName ?? payload.name;
  if (typeof direct === "string" && direct.trim()) return direct.trim();

  const tool = payload.tool;
  if (tool && typeof tool === "object") {
    const toolName = (tool as Record<string, unknown>).name;
    if (typeof toolName === "string" && toolName.trim()) {
      return toolName.trim();
    }
  }

  return null;
}

function looksLikeCodexEvent(payload: Record<string, unknown>): boolean {
  const providerHint = `${String(payload.provider ?? "")} ${String(payload.source ?? "")} ${String(payload.agent ?? "")}`
    .toLowerCase();
  if (providerHint.includes("codex")) return true;

  const modelHint = String(payload.model ?? payload.modelId ?? "").toLowerCase();
  if (modelHint.includes("codex")) return true;

  const eventHint = String(payload.type ?? payload.event ?? "").toLowerCase();
  if (eventHint.includes("codex")) return true;

  if (eventHint.includes("tool") && extractToolName(payload)) return true;

  return false;
}

export function parseCodexTelemetryEvent(
  input: CodexTelemetryParseInput,
): NormalizedCodexTelemetryEvent | null {
  const line = input.rawLine.trim();
  if (!line.startsWith("{")) return null;

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }

  if (!looksLikeCodexEvent(payload)) return null;

  const eventTypeRaw = payload.type ?? payload.event ?? "codex.unknown";
  const eventType = typeof eventTypeRaw === "string" ? eventTypeRaw : "codex.unknown";

  const eventIdRaw =
    payload.id ??
    payload.event_id ??
    payload.eventId ??
    payload.seq ??
    `${input.timestampMs}:${eventType}`;
  const eventId = String(eventIdRaw);

  const toolName = extractToolName(payload);

  return {
    runId: input.runId,
    nodeId: input.nodeId,
    iteration: input.iteration,
    attempt: input.attempt,
    timestampMs: input.timestampMs,
    eventType,
    eventKey: `codex:${input.runId}:${input.nodeId ?? ""}:${eventId}`,
    toolName,
    tokenUsage: extractTokenUsage(payload),
    payload,
  };
}

export function parseCodexTelemetryJsonLine(
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

export function ingestCodexTelemetryLines(
  input: Omit<CodexTelemetryParseInput, "rawLine"> & { lines: string[] },
): CodexTelemetryIngestResult {
  const events: NormalizedCodexTelemetryEvent[] = [];
  let malformedLines = 0;

  for (const line of input.lines ?? []) {
    const parsed = parseCodexTelemetryJsonLine(line);
    if (!parsed) {
      malformedLines += 1;
      continue;
    }

    const event = parseCodexTelemetryEvent({
      ...input,
      rawLine: JSON.stringify(parsed),
    });
    if (event) events.push(event);
  }

  return { events, malformedLines };
}
