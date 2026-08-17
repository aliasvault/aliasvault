#!/usr/bin/env node
// Upload a packaged extension zip to the Microsoft Edge Add-ons store
// and submit it for certification. Uses the v1 API key flow as documented at:
//   https://learn.microsoft.com/en-us/microsoft-edge/extensions-chromium/publish/api/using-addons-api
//
// Auth headers per request:
//   Authorization: ApiKey <EDGE_API_KEY>
//   X-ClientID:    <EDGE_CLIENT_ID>
//
// Required env vars (loaded by publish.sh from ~/.aliasvault/browser-extensions.env):
//   EDGE_PRODUCT_ID, EDGE_CLIENT_ID, EDGE_API_KEY
// Usage:
//   node publish-edge.mjs <path-to-zip> [notes-for-reviewer]

import { readFile } from "node:fs/promises";
import { argv, env, exit } from "node:process";

const API_BASE = "https://api.addons.microsoftedge.microsoft.com";
const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 10 * 60 * 1_000;

const [, , zipPath, notesArg] = argv;
if (!zipPath) {
  console.error("Usage: publish-edge.mjs <path-to-zip> [notes-for-reviewer]");
  exit(1);
}

const required = ["EDGE_PRODUCT_ID", "EDGE_CLIENT_ID", "EDGE_API_KEY"];
const missing = required.filter((k) => !env[k]);
if (missing.length > 0) {
  console.error(`Missing required env vars: ${missing.join(", ")}`);
  exit(1);
}

const productId = env.EDGE_PRODUCT_ID;
const notes = notesArg ?? "Automated submission via publish.sh";

const authHeaders = {
  Authorization: `ApiKey ${env.EDGE_API_KEY}`,
  "X-ClientID": env.EDGE_CLIENT_ID,
};

// Describe an HTTP error response.
async function describeError(res) {
  const body = await res.text();
  const detail = `${res.status} ${res.statusText}`.trim();
  return body ? `${detail} ${body}` : detail;
}

// Describe an authentication error.
function authHint(status) {
  if (status === 401) {
    return "\n   → The API key is rejected (expired or regenerated). Create a new key at\n     https://partner.microsoft.com/dashboard/microsoftedge/ → Publish API → Create API credentials,\n     then update EDGE_API_KEY in ~/.aliasvault/browser-extensions.env";
  }
  if (status === 403) {
    return "\n   → EDGE_CLIENT_ID is not valid for this account (check the Publish API page).";
  }
  if (status === 410) {
    return "\n   → Missing X-ClientID header; the deprecated v1 (bearer token) flow is retired.";
  }
  return "";
}

async function pollOperation(operationUrl, label) {
  const start = Date.now();
  while (Date.now() - start < POLL_TIMEOUT_MS) {
    const res = await fetch(operationUrl, { headers: authHeaders });
    if (!res.ok) {
      throw new Error(`${label} poll failed: ${await describeError(res)}${authHint(res.status)}`);
    }
    const data = await res.json();
    if (data.status === "Succeeded") {
      console.log(`  ✅ ${label} succeeded`);
      return data;
    }
    if (data.status === "Failed") {
      throw new Error(`${label} failed: ${JSON.stringify(data, null, 2)}`);
    }
    process.stdout.write(`  … ${label}: ${data.status}\r`);
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`${label} timed out after ${POLL_TIMEOUT_MS / 1000}s`);
}

async function uploadPackage(zipBytes) {
  const url = `${API_BASE}/v1/products/${productId}/submissions/draft/package`;
  const res = await fetch(url, {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/zip" },
    body: zipBytes,
  });
  if (res.status !== 202) {
    throw new Error(`Upload failed: ${await describeError(res)}${authHint(res.status)}`);
  }
  const location = res.headers.get("location");
  if (!location) {
    throw new Error("Upload response missing Location header (operation ID)");
  }
  return `${API_BASE}/v1/products/${productId}/submissions/draft/package/operations/${location}`;
}

async function publishSubmission(notesText) {
  const url = `${API_BASE}/v1/products/${productId}/submissions`;
  const res = await fetch(url, {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ notes: notesText }),
  });
  if (res.status !== 202) {
    throw new Error(`Publish failed: ${await describeError(res)}${authHint(res.status)}`);
  }
  const location = res.headers.get("location");
  if (!location) {
    throw new Error("Publish response missing Location header (operation ID)");
  }
  return `${API_BASE}/v1/products/${productId}/submissions/operations/${location}`;
}

console.log(`📤 Edge Add-ons publish for product ${productId}`);
console.log(`   Zip: ${zipPath}`);

const zipBytes = await readFile(zipPath);

console.log("⬆️  Uploading package…");
const uploadOpUrl = await uploadPackage(zipBytes);
await pollOperation(uploadOpUrl, "Package upload");

console.log("🚀 Submitting for certification…");
const publishOpUrl = await publishSubmission(notes);
await pollOperation(publishOpUrl, "Submission");

console.log("");
console.log("✅ Submitted to Edge Add-ons store for certification");
console.log("   Track status at: https://partner.microsoft.com/dashboard/microsoftedge/");
