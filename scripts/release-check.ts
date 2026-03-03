#!/usr/bin/env bun
/**
 * Release consistency check.
 *
 * Ensures package.json version has a corresponding section in CHANGELOG.md
 * before publishing.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const PACKAGE_JSON_PATH = join(ROOT, "package.json");
const CHANGELOG_PATH = join(ROOT, "CHANGELOG.md");

function fail(message: string): never {
  console.error(`❌ release-check: ${message}`);
  process.exit(1);
}

if (!existsSync(PACKAGE_JSON_PATH)) {
  fail("package.json not found");
}

if (!existsSync(CHANGELOG_PATH)) {
  fail("CHANGELOG.md not found");
}

const pkg = JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf8")) as {
  version?: string;
  name?: string;
};
const version = pkg.version?.trim();
if (!version) {
  fail("package.json version is missing");
}

const changelog = readFileSync(CHANGELOG_PATH, "utf8");

if (!/^## \[Unreleased\]/m.test(changelog)) {
  fail("CHANGELOG.md must contain a `## [Unreleased]` section");
}

const versionPatterns = [
  new RegExp(`^## \\[${version.replace(/\./g, "\\.")}\\]`, "m"),
  new RegExp(`^## ${version.replace(/\./g, "\\.")}\\b`, "m"),
];

if (!versionPatterns.some((pattern) => pattern.test(changelog))) {
  fail(
    `CHANGELOG.md is missing a section for version ${version} (expected heading like "## [${version}] - YYYY-MM-DD")`,
  );
}

console.log(
  `✅ release-check: ${pkg.name ?? "package"}@${version} has matching CHANGELOG entry`,
);
