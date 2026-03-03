import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  buildFallbackConfig,
  detectScriptRunner,
  loadPackageScripts,
  parseArgs,
  scanRepo,
  scriptCommand,
  slugify,
} from "./shared";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function mkTempRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "agentix-shared-test-"));
  tempDirs.push(dir);
  return dir;
}

describe("parseArgs", () => {
  test("parses positional args and valued/boolean flags", () => {
    const parsed = parseArgs([
      "run",
      "--cwd",
      "/repo",
      "--help",
      "--max-concurrency",
      "8",
    ]);

    expect(parsed.positional).toEqual(["run"]);
    expect(parsed.flags.cwd).toBe("/repo");
    expect(parsed.flags.help).toBe(true);
    expect(parsed.flags["max-concurrency"]).toBe("8");
  });
});

describe("detectScriptRunner and scriptCommand", () => {
  test("prefers bun when bun lockfile exists", async () => {
    const repo = await mkTempRepo();
    await writeFile(join(repo, "bun.lock"), "");

    expect(detectScriptRunner(repo)).toBe("bun");
    expect(scriptCommand("bun", "test")).toBe("bun run test");
  });

  test("builds expected runner commands", () => {
    expect(scriptCommand("pnpm", "test")).toBe("pnpm run test");
    expect(scriptCommand("yarn", "build")).toBe("yarn build");
    expect(scriptCommand("npm", "lint")).toBe("npm run lint");
  });
});

describe("slugify", () => {
  test("normalizes names into kebab-case", () => {
    expect(slugify("Agentix Core Platform")).toBe("agentix-core-platform");
    expect(slugify("###")).toBe("project");
  });
});

describe("loadPackageScripts", () => {
  test("loads scripts from package.json", async () => {
    const repo = await mkTempRepo();
    await writeFile(
      join(repo, "package.json"),
      JSON.stringify({ scripts: { test: "bun test", build: "bun run build" } }),
      "utf8",
    );

    const scripts = await loadPackageScripts(repo);
    expect(scripts).toEqual({ test: "bun test", build: "bun run build" });
  });

  test("returns empty object for invalid package.json", async () => {
    const repo = await mkTempRepo();
    await writeFile(join(repo, "package.json"), "{bad", "utf8");

    const scripts = await loadPackageScripts(repo);
    expect(scripts).toEqual({});
  });
});

describe("buildFallbackConfig", () => {
  test("creates fallback commands and chooses best specs path", async () => {
    const repo = await mkTempRepo();
    await writeFile(join(repo, "bun.lock"), "");
    await mkdir(join(repo, "docs/specs"), { recursive: true });
    await writeFile(join(repo, "docs/specs/engineering.md"), "# specs", "utf8");
    await writeFile(join(repo, "README.md"), "# readme", "utf8");

    const config = buildFallbackConfig(repo, "prompts/default.md", {});

    expect(config.projectName.length).toBeGreaterThan(0);
    expect(config.buildCmds.verify).toBe("bun run typecheck");
    expect(config.testCmds.tests).toBe("bun test");
    expect(config.specsPath).toBe(join(repo, "docs/specs/engineering.md"));
    expect(config.preLandChecks).toEqual(["bun run typecheck"]);
    expect(config.postLandChecks).toEqual(["bun test"]);
  });
});

describe("scanRepo", () => {
  test("derives runner commands from package scripts", async () => {
    const repo = await mkTempRepo();
    await writeFile(join(repo, "bun.lock"), "");
    await writeFile(
      join(repo, "package.json"),
      JSON.stringify({
        scripts: {
          typecheck: "tsc --noEmit",
          build: "bun run build",
          lint: "bun run lint",
          test: "bun test",
        },
      }),
      "utf8",
    );

    const scanned = await scanRepo(repo);

    expect(scanned.runner).toBe("bun");
    expect(scanned.buildCmds).toEqual({
      typecheck: "bun run typecheck",
      build: "bun run build",
      lint: "bun run lint",
    });
    expect(scanned.testCmds).toEqual({
      test: "bun run test",
    });
  });
});
