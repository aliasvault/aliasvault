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
//   node scripts/run-e2e.mjs [test numbers] [extra playwright args]
//
//   npm run test:e2e:build                all tests
//   npm run test:e2e:build 15             every test in file 15 (15.x)
//   npm run test:e2e:build 15.1           test 15.1; also 15.1,15.2 or 15.1-15.2
//   npm run test:e2e:h 15.1               same, in a visible browser, one test at a time
//   npm run test:e2e:p 15.1               same, and stops at each client.pause() in the Playwright Inspector

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

// Test numbers become one title filter (--grep), so selections combine as "or". Any other argument goes to Playwright as-is.
const playwrightArgs = [];
const patterns = [];
for (const arg of argv.slice(2)) {
  if (arg === "--pause") {
    childEnv.E2E_PAUSE = "1";
    playwrightArgs.push("--headed", "--workers=1");
    continue;
  }
  const selectors = arg.split(",").filter(Boolean);
  if (selectors.length > 0 && selectors.every(isSelector)) {
    patterns.push(...selectors.flatMap(toPatterns));
  } else {
    playwrightArgs.push(arg);
  }
}
if (patterns.length > 0) {
  // A test title starts with its number ("4.3 should ..."); the leading boundary keeps 4.3 from matching 14.3.
  playwrightArgs.push("--grep", `(^|\\s)(${patterns.join("|")})\\s`);
}

/**
 * Whether an argument selects tests: "4", "4.3" or "4.1-4.3".
 * @param {string} value
 */
function isSelector(value) {
  return /^\d+(\.\d+)?$/.test(value) || /^\d+\.\d+-\d+\.\d+$/.test(value);
}

/**
 * The title patterns a selector stands for.
 * @param {string} selector
 */
function toPatterns(selector) {
  const range = selector.match(/^(\d+)\.(\d+)-(\d+)\.(\d+)$/);
  if (range) {
    const [, file, from, toFile, to] = range.map(Number);
    if (file !== toFile || from > to) {
      console.error(`Invalid range "${selector}": use one file, low to high, e.g. 14.1-14.3.`);
      exit(1);
    }
    return Array.from({ length: to - from + 1 }, (_, i) => `${file}\\.${from + i}`);
  }
  return selector.includes(".") ? [selector.replace(".", "\\.")] : [`${Number(selector)}\\.\\d+`];
}

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
run("npx", ["playwright", "test", ...playwrightArgs]);
