<identity>
Agentix is an opinionated agentic workflow orchestrator for production-grade software delivery with DDD + BDD + TDD enforcement.
</identity>

<stack>
| Layer | Technology | Version | Notes |
|---|---|---|---|
| Runtime | Bun | >=1.3 | Primary runtime and package manager |
| Language | TypeScript | 5.6+ | `tsc --noEmit` via `bun run typecheck` |
| Workflow Engine | smithers-orchestrator | ^0.9.0 | JSX workflow runtime |
| Schema Validation | Zod | bundled | Structured agent outputs |
| Storage | SQLite | runtime | Smithers run/output persistence |
| VCS | jj (Jujutsu) | required | Git colocated mode |
</stack>

<structure>
- `src/cli/` : CLI entrypoints and orchestration bootstrapping [agent: create/modify]
- `src/components/` : Smithers workflow components and gates [agent: create/modify]
- `src/prompts/` : MDX prompt contracts for agent stages [agent: create/modify]
- `src/scheduled/` : unit/work-plan types, schemas, decomposition logic [agent: create/modify]
- `docs/` : doctrine, roadmap, architecture docs [agent: create/modify]
- `.agentix/` : generated runtime artifacts [agent: generate/read; do not commit]
- `.smithers/executions/` : run logs [agent: read only; do not commit]
- `node_modules/` : dependencies [agent: read only]
</structure>

<commands>
| Task | Command | Notes |
|---|---|---|
| Install deps | `bun install` | After dependency or lockfile changes |
| Typecheck | `bun run typecheck` | Includes MDX types generation |
| Test | `bun test` | Runs unit tests |
| Full local gate | `bun run check` | Typecheck + tests |
| CLI help | `bun run cli --help` | Uses package script |
| Initialize workflow | `bun run cli init ./path/to/rfc.md` | Generates `.agentix` artifacts |
| Regenerate plan | `bun run cli plan` | Recomputes work plan from config RFC |
| Execute workflow | `bun run cli run` | Runs scheduled-work pipeline |
| Resume workflow | `bun run cli run --resume <run-id>` | Restores a previous run |
| Monitor | `bun run cli monitor` | Attach monitor TUI |
| Status | `bun run cli status` | Show local workflow status |
</commands>

<conventions>
<code_style>
- Use TypeScript strict-safe patterns and existing file conventions.
- Keep schema and prompt contracts aligned; update both when fields change.
- Prefer explicit names (`boundedContext`, `gherkinScenarios`) over abbreviations.
- Preserve deterministic output schemas: no breaking shape changes without migration note.
</code_style>

<patterns>
<do>
- Encode domain boundaries per unit: bounded context, ubiquitous language, invariants.
- Encode executable behavior per unit: Gherkin scenarios with Given/When/Then.
- Enforce TDD sequencing for behavior changes.
- Gate completion on scenario coverage and invariant safety.
- Keep generated artifacts in `.agentix/` and logs in `.smithers/executions/` out of git.
</do>
<dont>
- Do not merge changes with uncovered scenarios.
- Do not accept "green" tests that do not prove observable behavior.
- Do not split tests into separate follow-up units; tests belong with implementation.
- Do not weaken review gates for convenience.
</dont>
</patterns>

<commit_conventions>
- Use conventional-style summaries (`feat:`, `fix:`, `chore:`) with clear scope.
- Keep commits cohesive to one intent (schema, prompts, docs, etc.).
</commit_conventions>
</conventions>

<workflows>
<new_feature>
1. Update/decompose RFC into units with DDD + BDD fields.
2. Ensure each unit has explicit invariants and Gherkin scenarios.
3. Implement prompt/schema updates if contract changes.
4. Run `bun run check`.
5. Update docs (`README.md`, `docs/*`) for behavior changes.
6. Review diff for slop risks (placeholder logic, weak tests, hidden failures).
7. Commit and push.
</new_feature>

<schema_or_prompt_change>
1. Change `src/scheduled/types.ts` and/or `src/scheduled/schemas.ts`.
2. Propagate fields through `src/components/QualityPipeline.tsx`.
3. Update affected `src/prompts/*.mdx` files.
4. Run `bun run typecheck` to regenerate `src/mdx.d.ts`.
5. Run `bun test`.
6. Validate README/docs consistency.
</schema_or_prompt_change>
</workflows>

<boundaries>
<forbidden>
- `.env`, `.env.*`, secrets, credentials, private keys.
- Destructive history rewrites (`git reset --hard`, force-push without instruction).
- Disabling tests or quality gates to make runs pass.
</forbidden>

<gated>
- `package.json` / `bun.lock` dependency changes.
- CI/deployment config changes under `.github/`.
- Core workflow gate logic in `src/components/ScheduledWorkflow.tsx`.
- Output contract changes in `src/scheduled/schemas.ts`.
</gated>

<safety_checks>
Before destructive or high-impact edits:
1. State intent and blast radius.
2. Stage minimally.
3. Verify with `bun run check`.
</safety_checks>
</boundaries>

<troubleshooting>
<known_issues>
| Symptom | Cause | Fix |
|---|---|---|
| Missing MDX prop type errors | `src/mdx.d.ts` stale | Run `bun run typecheck` |
| Workflow cannot resume | Missing/invalid `.agentix/workflow.db` | Re-run init/run or inspect `.agentix` state |
| Tests missing from quality pass | Check command not run | Run `bun run check` before commit |
| Agent commands fail | Required CLI missing (`claude`/`codex`/`jj`) | Install tools and retry |
</known_issues>

<recovery_patterns>
1. Re-read exact error and referenced file.
2. Confirm schema/prompt field parity.
3. Run `bun install` then `bun run check`.
4. Check git diff for partial refactors.
5. If blocked, isolate minimal failing unit and patch there first.
</recovery_patterns>
</troubleshooting>

<environment>
- Harness: Codex-style coding agent.
- Filesystem: full workspace access.
- Network: enabled.
- Tools: shell, git, gh, web browsing.
- Interaction: synchronous terminal chat.
</environment>

<skills>
Skills live in `.codex/skills/` and are symlinked to `.claude/skills/` and `.agents/skills/`.

Available local skills:
- `ddd-context-mapping`: derive bounded contexts, ubiquitous language, invariants.
- `bdd-gherkin-design`: author executable feature/scenario specs.
- `tdd-red-green-refactor`: enforce strict behavior-first implementation loops.
- `production-readiness-gates`: run non-slop quality checks before merge.

Load skill `SKILL.md` when entering its domain.
</skills>

<memory>
<project_decisions>
- 2026-03-03: Rebrand from prior fork naming to Agentix.
- 2026-03-03: Ignore `.smithers/executions/` artifacts in git.
- 2026-03-03: Adopt DDD + BDD + TDD as default orchestration doctrine.
</project_decisions>

<lessons_learned>
- Prompt-only quality rules drift unless tied to schema/gates.
- Scenario coverage must be explicit and machine-readable.
- Domain invariants reduce ambiguity during multi-agent parallel execution.
</lessons_learned>
</memory>
