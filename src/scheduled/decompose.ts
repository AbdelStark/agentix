/**
 * RFC Decomposition — AI-powered RFC → work units + dependency DAG.
 *
 * Takes an RFC file content and repo context, calls the Anthropic API
 * to produce a structured WorkPlan with parallelizable work units.
 */

import type { RepoConfig } from "../cli/shared";
import {
  workPlanSchema,
  workUnitSchema,
  type WorkPlan,
  type WorkUnit,
  validateDAG,
  computeLayers,
} from "./types";

const DECOMPOSE_SYSTEM_PROMPT = `You are a senior software architect decomposing an RFC/PRD into executable work units for an automated AI development pipeline.

Your job is to:
1. Read the RFC carefully and identify all discrete deliverables
2. Break them into work units that can be implemented independently
3. Determine dependency relationships between units
4. Assign complexity tiers based on scope
5. Write concrete acceptance criteria for each unit
6. Define a DDD boundary and BDD executable spec for each unit

## Rules

- Each work unit should be a single, cohesive piece of work
- **Prefer fewer, cohesive units over many granular ones.** Only split when units touch genuinely independent files. Each unit adds pipeline overhead (research, plan, implement, test, review) and merge risk. A larger unit that touches 5 related files is better than 3 small units that conflict at merge time.
- **Minimize cross-unit file overlap.** If two units would modify the same file, strongly prefer combining them into one unit. Cross-unit file overlap causes merge conflicts that require expensive re-runs.
- Dependencies should only exist where there's a real code dependency (shared types, imports, etc.)
- Don't create artificial sequential ordering — if two units can be done in parallel, they should have no deps between them
- Acceptance criteria must be verifiable (not vague like "works correctly")
- **Tests are part of the work unit, not a follow-on unit.** Do NOT create separate "write tests for X" units. Tests for a behavior are written alongside that behavior in the same unit. A unit that adds a feature includes both the implementation and the tests. A unit that fixes a bug includes the reproducing test and the fix. Never decompose "implement X" + "test X" as two separate units.
- Every unit must include a clear DDD boundary:
  - 'boundedContext': a stable domain boundary name (ex: "payments-ledger")
  - 'ubiquitousLanguage': at least one domain term that must remain consistent in code/tests/docs
  - 'domainInvariants': at least one non-negotiable business rule that cannot be broken
- Every unit must include BDD executable specifications:
  - 'gherkinFeature': feature name
  - 'gherkinRule': optional rule grouping (or null)
  - 'gherkinScenarios': one or more concrete Given/When/Then scenarios, each observable and testable
- Gherkin scenarios must be specific enough that a test can be written directly from each scenario without guessing.
- Acceptance criteria and Gherkin scenarios must align 1:1 in intent.

## Complexity Tiers

- **trivial**: Config changes, metadata updates, file deletions, re-exports. No logic changes.
- **small**: Single-file changes with clear scope. Adding exports, simple refactors, thin wrappers.
- **medium**: Multi-file features, API changes, refactors touching 3-5 files. Needs research and review.
- **large**: Architectural changes, new subsystems, security-sensitive work. Needs full pipeline.

## Output Format

Return ONLY valid JSON matching this schema:
{
  "units": [
    {
      "id": "kebab-case-id",
      "name": "Human Readable Name",
      "rfcSections": ["§3", "§3.2"],
      "description": "What needs to be done, in detail",
      "deps": ["other-unit-id"],
      "acceptance": ["specific verifiable criterion"],
      "boundedContext": "payments-ledger",
      "ubiquitousLanguage": ["settlement", "capture", "authorization"],
      "domainInvariants": ["A capture cannot exceed its authorization amount"],
      "gherkinFeature": "Capture authorized payment",
      "gherkinRule": "Captured amount stays within authorization",
      "gherkinScenarios": [
        {
          "id": "capture-within-authorized-limit",
          "title": "Capture succeeds when within authorization amount",
          "given": ["an authorization exists for 100 USD"],
          "when": ["a capture for 40 USD is requested"],
          "then": ["capture succeeds", "remaining capturable amount is 60 USD"]
        }
      ],
      "tier": "small"
    }
  ]
}`;

function buildDecomposePrompt(
  rfcContent: string,
  repoConfig: RepoConfig,
): string {
  const repoInfo = [
    `Project: ${repoConfig.projectName}`,
    `Package manager: ${repoConfig.runner}`,
    repoConfig.buildCmds && Object.keys(repoConfig.buildCmds).length > 0
      ? `Build commands: ${Object.entries(repoConfig.buildCmds).map(([k, v]) => `${k}: ${v}`).join(", ")}`
      : null,
    repoConfig.testCmds && Object.keys(repoConfig.testCmds).length > 0
      ? `Test commands: ${Object.entries(repoConfig.testCmds).map(([k, v]) => `${k}: ${v}`).join(", ")}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  return `## Repository Context

${repoInfo}

## RFC Content

${rfcContent}

## Task

Decompose this RFC into work units. Prefer fewer cohesive units over many granular ones — minimize cross-unit file overlap to avoid merge conflicts. Only add dependencies where there's a real code dependency. Each unit must carry:
- DDD boundary metadata ('boundedContext', 'ubiquitousLanguage', 'domainInvariants')
- BDD executable specification ('gherkinFeature', 'gherkinRule', 'gherkinScenarios' with Given/When/Then)
Return ONLY the JSON object.`;
}

type DecomposePayload = {
  units: WorkUnit[];
};

function normalizeUnitsPayload(parsed: unknown): unknown {
  if (Array.isArray(parsed)) return parsed;
  if (!parsed || typeof parsed !== "object") return null;

  const record = parsed as Record<string, unknown>;
  if (Array.isArray(record.units)) return record.units;

  const candidates = ["plan", "workPlan", "result", "data"];
  for (const key of candidates) {
    const nested = record[key];
    if (nested && typeof nested === "object") {
      const nestedUnits = (nested as Record<string, unknown>).units;
      if (Array.isArray(nestedUnits)) return nestedUnits;
    }
  }

  return null;
}

export function extractJsonPayload(rawResult: string): string {
  const fenceMatch = rawResult.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) return fenceMatch[1].trim();

  const trimmed = rawResult.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return trimmed;

  const balanced = extractBalancedJson(trimmed);
  return (balanced ?? trimmed).trim();
}

function extractBalancedJson(input: string): string | null {
  const objStart = input.indexOf("{");
  const arrStart = input.indexOf("[");
  const starts = [objStart, arrStart].filter((idx) => idx >= 0);
  if (starts.length === 0) return null;

  const start = Math.min(...starts);
  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (let i = start; i < input.length; i += 1) {
    const ch = input[i];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === "\"") inString = false;
      continue;
    }

    if (ch === "\"") {
      inString = true;
      continue;
    }

    if (ch === "{") {
      stack.push("}");
      continue;
    }
    if (ch === "[") {
      stack.push("]");
      continue;
    }
    if ((ch === "}" || ch === "]") && stack[stack.length - 1] === ch) {
      stack.pop();
      if (stack.length === 0) {
        return input.slice(start, i + 1);
      }
    }
  }

  return null;
}

export function parseDecomposeResponse(rawResult: string): DecomposePayload {
  const jsonStr = extractJsonPayload(rawResult);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown parse error";
    throw new Error(
      `Failed to parse AI response as JSON: ${message}\n\nRaw response:\n${rawResult.slice(0, 500)}`,
    );
  }

  const unitsPayload = normalizeUnitsPayload(parsed);
  if (!Array.isArray(unitsPayload) || unitsPayload.length === 0) {
    throw new Error(
      "AI returned no work units. Expected `units` array in top-level object, nested plan, or direct array.",
    );
  }

  const units = workUnitSchema.array().parse(unitsPayload);
  return { units };
}

/**
 * Decompose an RFC into work units using the Anthropic API.
 */
export async function decomposeRFC(
  rfcContent: string,
  repoConfig: RepoConfig,
): Promise<{ plan: WorkPlan; layers: WorkUnit[][] }> {
  const prompt = buildDecomposePrompt(rfcContent, repoConfig);

  const spinner = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let spinIdx = 0;
  const spinInterval = setInterval(() => {
    process.stdout.write(
      `\r${spinner[spinIdx++ % spinner.length]} Decomposing RFC into work units...`,
    );
  }, 80);

  let rawResult: string;
  try {
    rawResult = await callAI(prompt);
  } finally {
    clearInterval(spinInterval);
    process.stdout.write("\r\x1b[K");
  }
  const { units } = parseDecomposeResponse(rawResult);

  // Validate DAG
  const dagResult = validateDAG(units);
  if (!dagResult.valid) {
    throw new Error(
      `Invalid dependency graph:\n${dagResult.errors.join("\n")}`,
    );
  }

  const plan: WorkPlan = {
    source: "", // caller fills this
    generatedAt: new Date().toISOString(),
    repo: {
      projectName: repoConfig.projectName,
      buildCmds: repoConfig.buildCmds,
      testCmds: repoConfig.testCmds,
    },
    units,
  };

  // Validate against schema
  workPlanSchema.parse(plan);

  const layers = computeLayers(units);

  return { plan, layers };
}

/**
 * Call the Anthropic API (or fall back to claude CLI).
 */
async function callAI(prompt: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (apiKey) {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 8192,
        system: DECOMPOSE_SYSTEM_PROMPT,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!resp.ok) {
      throw new Error(`Anthropic API ${resp.status}: ${await resp.text()}`);
    }

    const data = (await resp.json()) as any;
    const text = data.content?.[0]?.text ?? "";
    if (!text.trim()) throw new Error("Empty API response");
    return text;
  }

  // Fallback to claude CLI
  console.log("  (no API key, falling back to claude CLI...)\n");
  const claudeEnv = { ...process.env, ANTHROPIC_API_KEY: "" };
  delete (claudeEnv as any).CLAUDECODE;

  const fullPrompt = `${DECOMPOSE_SYSTEM_PROMPT}\n\n${prompt}`;
  const proc = Bun.spawn(
    [
      "claude",
      "--print",
      "--output-format",
      "text",
      "--model",
      "claude-sonnet-4-6",
      fullPrompt,
    ],
    {
      stdout: "pipe",
      stderr: "pipe",
      env: claudeEnv,
    },
  );

  const out = await new Response(proc.stdout).text();
  const err = await new Response(proc.stderr).text();
  const code = await proc.exited;

  if (code !== 0 || !out.trim()) {
    throw new Error(`claude CLI failed (code ${code}): ${err}`);
  }

  return out.trim();
}

/**
 * Pretty-print a work plan summary to the console.
 */
export function printPlanSummary(
  plan: WorkPlan,
  layers: WorkUnit[][],
): void {
  const tierCounts = { trivial: 0, small: 0, medium: 0, large: 0 };
  const boundedContexts = new Set<string>();
  let scenarioCount = 0;
  for (const u of plan.units) {
    tierCounts[u.tier]++;
    boundedContexts.add(u.boundedContext);
    scenarioCount += u.gherkinScenarios.length;
  }

  console.log(
    `\n  Generated ${plan.units.length} work units in ${layers.length} parallelizable layers\n`,
  );

  console.log("  Tiers:");
  for (const [tier, count] of Object.entries(tierCounts)) {
    if (count > 0) console.log(`    ${tier}: ${count}`);
  }
  console.log(`\n  Bounded contexts: ${boundedContexts.size}`);
  console.log(`  Gherkin scenarios: ${scenarioCount}`);

  console.log("\n  Execution layers (units in same layer run in parallel):");
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    const names = layer.map((u) => u.id).join(", ");
    console.log(`    Layer ${i}: [${names}]`);
  }

  console.log();
}
