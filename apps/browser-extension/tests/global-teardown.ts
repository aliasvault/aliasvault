/**
 * Global teardown for E2E tests.
 *
 * Ensures all browser contexts are properly closed after test runs.
 */

import { closeCachedContext } from './fixtures';

export default async function globalTeardown(): Promise<void> {
  await closeCachedContext();
}
