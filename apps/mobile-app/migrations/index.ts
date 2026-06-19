import { migrateLegacyApiUrl } from '@/migrations/0.29.7-LegacyApiUrlMigration';

/**
 * Generic entry point for one-time startup migrations. Called once during cold-start boot;
 * add any future migration as another awaited call below. Each migration must be idempotent and
 * swallow its own errors so a single failure cannot block startup.
 *
 * Keeping every migration behind this single function means callers never touch app internals,
 * and retiring a migration later is just deleting its file and removing its line here.
 */
export async function runStartupMigrations(): Promise<void> {
  // 0.29.7: Migrate legacy aliasvault.net URLs to aliasvault.com defaults.
  await migrateLegacyApiUrl();
}
