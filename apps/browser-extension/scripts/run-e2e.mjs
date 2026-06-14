#!/usr/bin/env node
// Build the Chrome extension for E2E testing and run the Playwright suite
// against it.
//
// Resolves the local dev API URL from `dev.env` (or ALIASVAULT_API_URL / the
// default) and exposes it to Playwright as ALIASVAULT_API_URL. The fixtures use
// it to point the extension at that API instance at runtime and to create the
// test user, so everything targets the same API.
//
// Usage:
//   node scripts/run-e2e.mjs [extra playwright args]

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { argv, env, exit, platform } from "node:process";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const extensionDir = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(extensionDir, "..", "..");
const devEnvPath = path.join(repoRoot, "dev.env");

// Default port layout, kept in sync with scripts/dev.sh.
const DEFAULT_BASE_PORT = 5100;
const DEFAULT_PORT_STRIDE = 10;

/**
 * Resolve the API URL the test extension should default to.
 * @returns {string}
 */
function resolveApiUrl() {
  if (env.ALIASVAULT_API_URL) {
    return env.ALIASVAULT_API_URL;
  }

  try {
    const devEnv = {};
    for (const line of readFileSync(devEnvPath, "utf8").split("\n")) {
      const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
      if (match) {
        devEnv[match[1]] = match[2];
      }
    }

    const base = Number(devEnv.AV_BASE_PORT ?? DEFAULT_BASE_PORT);
    const stride = Number(devEnv.AV_PORT_STRIDE ?? DEFAULT_PORT_STRIDE);
    const instance = Number(devEnv.AV_INSTANCE ?? 0);

    if ([base, stride, instance].every(Number.isInteger)) {
      return `http://localhost:${base + instance * stride}`;
    }
  } catch {
    // No readable dev.env — fall through to the default below.
  }

  return `http://localhost:${DEFAULT_BASE_PORT}`;
}

const apiUrl = resolveApiUrl();
console.log(`[e2e] Using API URL: ${apiUrl}`);

// Expose the URL to the Playwright fixtures (global setup + per-test setup),
// which configure the extension to talk to this API instance and create the
// test user against it.
const childEnv = {
  ...env,
  ALIASVAULT_API_URL: apiUrl,
};

/**
 * Run a command with inherited stdio, exiting on failure.
 * @param {string} command
 * @param {string[]} commandArgs
 */
function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    cwd: extensionDir,
    env: childEnv,
    stdio: "inherit",
    shell: platform === "win32",
  });
  if (result.status !== 0) {
    exit(result.status ?? 1);
  }
}

run("npm", ["run", "build:chrome"]);
run("npx", ["playwright", "test", ...argv.slice(2)]);
