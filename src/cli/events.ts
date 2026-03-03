import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export type AgentixCommand = "init" | "plan" | "run" | "status" | "monitor";

export type AgentixEvent = {
  ts: string;
  level: "info" | "error";
  event: string;
  command: AgentixCommand;
  runId?: string;
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
