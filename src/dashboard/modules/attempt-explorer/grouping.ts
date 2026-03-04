export type AttemptTimelineEntry = {
  nodeId: string;
  attempt: number;
  state: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  responseText: string | null;
  meta?: Record<string, unknown> | null;
};

export type AttemptGroup = {
  nodeId: string;
  attempts: AttemptTimelineEntry[];
  latestState: string;
  totalDurationMs: number;
  retries: number;
};

export type VirtualLogWindow<T> = {
  totalRows: number;
  startIndex: number;
  endIndex: number;
  paddingTopPx: number;
  paddingBottomPx: number;
  items: T[];
};

function sortChronologically(a: AttemptTimelineEntry, b: AttemptTimelineEntry): number {
  const aStart = a.startedAt ? Date.parse(a.startedAt) : 0;
  const bStart = b.startedAt ? Date.parse(b.startedAt) : 0;
  if (aStart !== bStart) return aStart - bStart;
  return a.attempt - b.attempt;
}

export function groupAttemptsByNode(
  attempts: AttemptTimelineEntry[],
): AttemptGroup[] {
  const map = new Map<string, AttemptTimelineEntry[]>();

  for (const attempt of attempts ?? []) {
    const bucket = map.get(attempt.nodeId) ?? [];
    bucket.push(attempt);
    map.set(attempt.nodeId, bucket);
  }

  const groups: AttemptGroup[] = [];
  for (const [nodeId, entries] of map.entries()) {
    entries.sort(sortChronologically);
    const latest = entries[entries.length - 1];
    const totalDurationMs = entries.reduce(
      (sum, entry) => sum + Math.max(0, entry.durationMs ?? 0),
      0,
    );

    groups.push({
      nodeId,
      attempts: entries,
      latestState: latest?.state ?? "unknown",
      totalDurationMs,
      retries: Math.max(0, entries.length - 1),
    });
  }

  groups.sort((a, b) => a.nodeId.localeCompare(b.nodeId));
  return groups;
}

export function filterLogsByStream<T extends { stream: "stdout" | "stderr" }>(
  logs: T[],
  stream: "all" | "stdout" | "stderr",
): T[] {
  if (stream === "all") return logs;
  return logs.filter((log) => log.stream === stream);
}

export function buildVirtualLogWindow<T>(opts: {
  logs: T[];
  rowHeightPx: number;
  viewportHeightPx: number;
  scrollTopPx: number;
  overscanRows?: number;
}): VirtualLogWindow<T> {
  const logs = opts.logs ?? [];
  const totalRows = logs.length;

  const rowHeightPx = Number.isFinite(opts.rowHeightPx) && opts.rowHeightPx > 0
    ? Math.floor(opts.rowHeightPx)
    : 28;
  const viewportHeightPx = Number.isFinite(opts.viewportHeightPx) && opts.viewportHeightPx > 0
    ? Math.floor(opts.viewportHeightPx)
    : rowHeightPx * 8;
  const scrollTopPx = Number.isFinite(opts.scrollTopPx) && opts.scrollTopPx > 0
    ? Math.floor(opts.scrollTopPx)
    : 0;
  const overscanRows = Number.isFinite(opts.overscanRows) && (opts.overscanRows ?? 0) >= 0
    ? Math.floor(opts.overscanRows ?? 0)
    : 4;

  const visibleRows = Math.max(1, Math.ceil(viewportHeightPx / rowHeightPx));
  const firstVisibleRow = Math.max(0, Math.floor(scrollTopPx / rowHeightPx));
  const startIndex = Math.max(0, firstVisibleRow - overscanRows);
  const endIndex = Math.min(
    Math.max(0, totalRows - 1),
    firstVisibleRow + visibleRows + overscanRows - 1,
  );

  const hasRows = totalRows > 0;
  const finalStart = hasRows ? startIndex : 0;
  const finalEnd = hasRows ? endIndex : -1;
  const items = hasRows ? logs.slice(finalStart, finalEnd + 1) : [];

  const paddingTopPx = finalStart * rowHeightPx;
  const renderedRows = items.length;
  const paddingBottomPx = Math.max(
    0,
    (totalRows - finalStart - renderedRows) * rowHeightPx,
  );

  return {
    totalRows,
    startIndex: finalStart,
    endIndex: finalEnd,
    paddingTopPx,
    paddingBottomPx,
    items,
  };
}

export function deriveAttemptFocusFromEvent(
  event: {
    type?: string;
    payload?: Record<string, unknown>;
  } | null | undefined,
): { nodeId: string; attempt: number | null } | null {
  if (!event || event.type !== "NodeOutput" || !event.payload) return null;
  const nodeId = event.payload.nodeId;
  if (typeof nodeId !== "string" || !nodeId.trim()) return null;

  const rawAttempt = event.payload.attempt;
  const attempt = typeof rawAttempt === "number" && Number.isFinite(rawAttempt)
    ? Math.floor(rawAttempt)
    : typeof rawAttempt === "string" && rawAttempt.trim() && Number.isFinite(Number(rawAttempt))
      ? Math.floor(Number(rawAttempt))
      : null;

  return {
    nodeId: nodeId.trim(),
    attempt,
  };
}
