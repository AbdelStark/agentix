import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export const AGENTIX_EVENT_SCHEMA_VERSION = 2;

export type AgentixCommand =
  | "init"
  | "plan"
  | "run"
  | "status"
  | "monitor"
  | "analytics";

export type AgentixEvent = {
  schemaVersion?: number;
  ts: string;
  level: "info" | "error";
  event: string;
  command: AgentixCommand;
  runId?: string;
  sessionId?: string;
  unitId?: string;
  details?: Record<string, unknown>;
};

const EVENTS_FILE = "events.jsonl";

export async function appendAgentixEvent(
  agentixDir: string,
  payload: Omit<AgentixEvent, "ts">,
): Promise<void> {
  try {
    await mkdir(agentixDir, { recursive: true });
    const event: AgentixEvent = {
      schemaVersion: AGENTIX_EVENT_SCHEMA_VERSION,
      ts: new Date().toISOString(),
      ...payload,
    };
    await appendFile(
      join(agentixDir, EVENTS_FILE),
      JSON.stringify(event) + "\n",
      "utf8",
    );
  } catch {
    // Never fail command execution due to telemetry.
  }
}
