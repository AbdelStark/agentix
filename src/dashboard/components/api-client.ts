export type ApiListResponse<T> = {
  items: T[];
  meta: {
    limit: number;
    offset: number;
    total: number;
    warnings: string[];
  };
};

const AUTH_TOKEN =
  typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("token")
    : null;

function withAuthToken(path: string): string {
  if (!AUTH_TOKEN || typeof window === "undefined") return path;
  const url = new URL(path, window.location.origin);
  if (!url.searchParams.has("token")) {
    url.searchParams.set("token", AUTH_TOKEN);
  }
  return `${url.pathname}${url.search}`;
}

async function readJson<T>(path: string): Promise<T> {
  const response = await fetch(withAuthToken(path), {
    headers: {
      accept: "application/json",
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${body}`);
  }

  return (await response.json()) as T;
}

export const dashboardApi = {
  health: () => readJson<{ status: string; mode: string; now: string }>("/api/health"),
  listRuns: () => readJson<ApiListResponse<any>>("/api/runs?limit=200&offset=0"),
  getRun: (runId: string) => readJson<any>(`/api/runs/${encodeURIComponent(runId)}`),
  listNodes: (runId: string) =>
    readJson<ApiListResponse<any>>(
      `/api/runs/${encodeURIComponent(runId)}/nodes?limit=2000&offset=0`,
    ),
  listAttempts: (runId: string) =>
    readJson<ApiListResponse<any>>(
      `/api/runs/${encodeURIComponent(runId)}/attempts?limit=2000&offset=0`,
    ),
  listPrompts: (runId: string) =>
    readJson<ApiListResponse<any>>(
      `/api/runs/${encodeURIComponent(runId)}/prompts?limit=2000&offset=0`,
    ),
  listExecutionSteps: (runId: string) =>
    readJson<ApiListResponse<any>>(
      `/api/runs/${encodeURIComponent(runId)}/execution-steps?limit=5000&offset=0`,
    ),
  listTimeline: (runId: string) =>
    readJson<ApiListResponse<any>>(
      `/api/runs/${encodeURIComponent(runId)}/timeline?limit=5000&offset=0`,
    ),
  listEvents: (runId: string) =>
    readJson<ApiListResponse<any>>(
      `/api/runs/${encodeURIComponent(runId)}/events?limit=2000&offset=0`,
    ),
  listLogs: (runId: string) =>
    readJson<ApiListResponse<any>>(
      `/api/runs/${encodeURIComponent(runId)}/logs?limit=5000&offset=0`,
    ),
  listStageOutputs: (runId: string) =>
    readJson<ApiListResponse<any>>(
      `/api/runs/${encodeURIComponent(runId)}/stage-outputs?limit=5000&offset=0`,
    ),
  listMergeRisk: (runId: string) =>
    readJson<ApiListResponse<any>>(
      `/api/runs/${encodeURIComponent(runId)}/merge-risk?limit=50&offset=0`,
    ),
  listToolEvents: (runId: string) =>
    readJson<ApiListResponse<any>>(
      `/api/runs/${encodeURIComponent(runId)}/tool-events?limit=5000&offset=0`,
    ),
  listResources: (runId: string) =>
    readJson<ApiListResponse<any>>(
      `/api/runs/${encodeURIComponent(runId)}/resources?limit=5000&offset=0`,
    ),
  workPlan: () => readJson<{ workPlan: any; warnings: string[] }>("/api/work-plan"),
  traces: () => readJson<ApiListResponse<any>>("/api/traces"),
  analytics: () => readJson<ApiListResponse<any>>("/api/analytics"),
  commands: () => readJson<ApiListResponse<any>>("/api/commands?limit=2000&offset=0"),
};
