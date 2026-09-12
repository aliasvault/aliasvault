#!/usr/bin/env node
// Installs the dependencies of the core packages this extension links with `file:`
// references (core/client, core/models, core/vault).
//
// npm symlinks a `file:` dependency but never installs that package's own
// dependencies, so core/client is left without `sql.js` and `otpauth`. Both are
// resolved from core/client's own node_modules when the extension is built (the
// linked package lives outside this project's node_modules tree), and
// wxt.config.ts copies the sql.js wasm file out of it, so the build fails without
// this step. Running it from `preinstall` also makes the Firefox sources archive,
// which ships core/* next to the extension, build with a plain `npm install`.
//
// Usage:
//   node scripts/install-core-deps.mjs

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { env, exit, platform } from "node:process";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const extensionDir = path.resolve(scriptDir, "..");

/*
 * npm exports its own project root to lifecycle scripts, and a nested npm picks that
 * up over the cwd we hand it, which would install into the extension instead of the
 * core package. Drop the path-scoped config so the child install stays in its own
 * directory, and keep the rest (registry, cache, proxy) intact.
 */
const childEnv = { ...env };
delete childEnv.npm_config_local_prefix;
delete childEnv.npm_config_workspace;
delete childEnv.npm_config_workspaces;

/**
 * Read a package.json, returning null when it is missing or unreadable.
 * @param {string} packageDir
 * @returns {Record<string, any> | null}
 */
function readManifest(packageDir) {
  try {
    return JSON.parse(readFileSync(path.join(packageDir, "package.json"), "utf8"));
  } catch {
    return null;
  }
}

/**
 * Resolve the directories of a package's `file:` dependencies.
 * @param {string} packageDir
 * @param {Record<string, any>} manifest
 * @returns {string[]}
 */
function linkedDirs(packageDir, manifest) {
  return Object.values(manifest.dependencies ?? {})
    .filter((spec) => typeof spec === "string" && spec.startsWith("file:"))
    .map((spec) => path.resolve(packageDir, spec.slice("file:".length)));
}

/**
 * Collect every `file:` linked package reachable from the extension.
 * @returns {string[]}
 */
function collectLinkedPackages() {
  const extensionManifest = readManifest(extensionDir);
  if (!extensionManifest) {
    return [];
  }

  const collected = [];
  const seen = new Set([extensionDir]);
  const queue = linkedDirs(extensionDir, extensionManifest);

  while (queue.length > 0) {
    const packageDir = queue.shift();
    if (seen.has(packageDir)) {
      continue;
    }
    seen.add(packageDir);

    const manifest = readManifest(packageDir);
    if (!manifest) {
      continue;
    }

    collected.push(packageDir);
    queue.push(...linkedDirs(packageDir, manifest));
  }

  return collected;
}

/**
 * List the registry dependencies of a package that are not installed in it yet.
 * @param {string} packageDir
 * @returns {string[]}
 */
function missingDependencies(packageDir) {
  const manifest = readManifest(packageDir);
  return Object.entries(manifest?.dependencies ?? {})
    .filter(([, spec]) => !(typeof spec === "string" && spec.startsWith("file:")))
    .map(([name]) => name)
    .filter((name) => !existsSync(path.join(packageDir, "node_modules", name)));
}

for (const packageDir of collectLinkedPackages()) {
  const missing = missingDependencies(packageDir);
  if (missing.length === 0) {
    continue;
  }

  const relativeDir = path.relative(extensionDir, packageDir);
  console.log(`[core-deps] Installing dependencies for ${relativeDir} (missing: ${missing.join(", ")})`);

  const result = spawnSync("npm", ["install", "--omit=dev", "--no-audit", "--no-fund"], {
    cwd: packageDir,
    env: childEnv,
    stdio: "inherit",
    shell: platform === "win32",
  });

  if (result.status !== 0) {
    console.error(`[core-deps] Failed to install dependencies for ${relativeDir}`);
    exit(result.status ?? 1);
  }
}
