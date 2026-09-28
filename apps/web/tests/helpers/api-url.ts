import { readFileSync } from 'node:fs';
import path from 'node:path';

/** Default port layout, kept in sync with scripts/dev.sh. */
const DEFAULT_BASE_PORT = 5100;
const DEFAULT_PORT_STRIDE = 10;

/**
 * Resolve the API URL the tests run against: ALIASVAULT_API_URL, else the API port of the repo's dev.env instance.
 */
export function resolveApiUrl(): string {
  if (process.env.ALIASVAULT_API_URL) {
    return process.env.ALIASVAULT_API_URL.replace(/\/$/, '');
  }

  try {
    const devEnv: Record<string, string> = {};
    const devEnvPath = path.resolve(import.meta.dirname, '..', '..', '..', '..', 'dev.env');
    for (const line of readFileSync(devEnvPath, 'utf8').split('\n')) {
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
    // No readable dev.env, fall through to the default.
  }

  return `http://localhost:${DEFAULT_BASE_PORT}`;
}
