export type AnalyticsTrendPoint = {
  date: string;
  started: number;
  completed: number;
  failed: number;
  cancelled: number;
};

export type AnalyticsSeries = {
  dates: string[];
  successRate: number[];
  failureRate: number[];
  cancellationRate: number[];
};

function asNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

export function buildAnalyticsSeries(points: AnalyticsTrendPoint[]): AnalyticsSeries {
  const sorted = [...(points ?? [])].sort((a, b) => a.date.localeCompare(b.date));

  const dates: string[] = [];
  const successRate: number[] = [];
  const failureRate: number[] = [];
  const cancellationRate: number[] = [];

  for (const point of sorted) {
    const started = asNumber(point.started);
    const completed = asNumber(point.completed);
    const failed = asNumber(point.failed);
    const cancelled = asNumber(point.cancelled);
    const terminal = Math.max(1, completed + failed + cancelled);

    dates.push(point.date);
    successRate.push(Number((completed / terminal).toFixed(4)));
    failureRate.push(Number((failed / terminal).toFixed(4)));
    cancellationRate.push(Number((cancelled / terminal).toFixed(4)));
  }

  return { dates, successRate, failureRate, cancellationRate };
}

export function summarizeFailureTaxonomy(
  taxonomy: Record<string, number>,
): Array<{ reason: string; count: number }> {
  return Object.entries(taxonomy ?? {})
    .map(([reason, count]) => ({ reason, count: asNumber(count) }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}
