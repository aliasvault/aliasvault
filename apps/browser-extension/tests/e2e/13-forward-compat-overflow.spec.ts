/**
 * Category 13: Forward-compat overflow — no data loss (Requires API)
 *
 * These tests enforce the manifest-v1 forward-compatibility guarantee: when a NEWER client writes
 * vault data this client's schema doesn't know (a new row column, a whole new table), the current
 * extension must (a) still load the vault, and (b) carry that unknown data through its own pushes
 * untouched instead of silently deleting it (see `CodecOverflow` in the Rust vault codec).
 *
 * Scenario:
 * 1. Extension client creates a credential and syncs (migrating the account to manifest-v1)
 * 2. A simulated "newer client" (node-side, real Rust WASM codec) pulls the manifest, injects an
 *    unknown column (`Items.AliasEnabled`) and an unknown table (`FutureFeatures`), and pushes it
 *    back as a new revision
 * 3. The extension pulls that manifest — the vault must load and stay fully usable
 * 4. The extension edits the credential (rename) and pushes
 * 5. The newer client pulls again — the rename is applied AND the unknown column/table are intact
 */
import { test, expect, TestClient, FieldSelectors } from '../fixtures';
import { getVaultSnapshot, openManifest, pushManifest, pollUntil, requireRootManifest, type DecryptedManifest } from '../helpers/manifest-v2-api';
import type { TestUser } from '../helpers/test-api';

test.describe.serial('13. Forward-compat overflow', () => {
  let client: TestClient;
  /** The account under test — the testUser fixture is per-test, so 13.1 pins it for later tests. */
  let user: TestUser;
  let baseApiUrl: string;

  const credentialName = `Overflow Credential ${Date.now()}`;
  const renamedCredentialName = `${credentialName} renamed`;
  const futureTableRow = { Id: 'f1e2e000-0000-4000-8000-000000000001', Payload: 'from-the-future' };

  /** Manifest revision created by the simulated newer client in 13.2. */
  let injectedRevision: number;

  test.afterAll(async () => {
    await client?.cleanup();
  });

  test('13.1 extension client should create a credential and sync to manifest-v1', async ({ testUser, apiUrl }) => {
    user = testUser;
    baseApiUrl = apiUrl;
    client = await TestClient.create();
    await client.login(apiUrl, testUser.username, testUser.password);

    await client
      .goToVault()
      .then((c) => c.createCredential(credentialName, 'overflow@example.com', 'OverflowPass123!'))
      .then((c) => c.verifyCredentialExists(credentialName))
      .then((c) => c.triggerSync())
      .then((c) => c.screenshot('13.1-credential-created.png'));

    // The save's push runs in the background; wait until the server actually holds a manifest-v1
    // snapshot whose Items table contains the credential.
    const { manifest } = await openLatestManifest(apiUrl, user.token!.token, user.encryptionKey!);
    const item = (manifest.tables.Items ?? []).find((row) => row.Name === credentialName);
    expect(item, 'credential row should be present in the server manifest').toBeTruthy();
  });

  test('13.2 a newer client should inject an unknown column and table into the server manifest', async () => {
    const token = user.token!.token;
    const { manifest, root } = await openLatestManifest(baseApiUrl, token, user.encryptionKey!);

    // Simulate a newer client's schema additions: a column this extension build doesn't know on an
    // existing row, and a whole table it doesn't know at all.
    const item = (manifest.tables.Items ?? []).find((row) => row.Name === credentialName);
    expect(item).toBeTruthy();
    item!.AliasEnabled = true;
    manifest.tables.FutureFeatures = [futureTableRow];

    injectedRevision = await pushManifest(baseApiUrl, token, user.username, manifest, root.revision, root.blobReferences, user.encryptionKey!);
    expect(injectedRevision).toBeGreaterThan(root.revision);
  });

  test('13.3 extension should load the newer manifest without crashing', async () => {
    await client
      .triggerSync()
      .then((c) => c.goToVault())
      .then((c) => c.verifyCredentialExists(credentialName))
      .then((c) => c.screenshot('13.3-newer-manifest-loaded.png'));
  });

  test('13.4 extension should edit the credential and push', async () => {
    await client
      .clickCredential(credentialName)
      .then((c) => c.openEditForm())
      .then((c) => c.fillField(FieldSelectors.ITEM_NAME, renamedCredentialName))
      .then((c) => c.saveCredential())
      .then((c) => c.verifyCredentialExists(renamedCredentialName))
      .then((c) => c.triggerSync())
      .then((c) => c.screenshot('13.4-credential-renamed.png'));
  });

  test('13.5 the newer client data should survive the extension push (no data loss)', async () => {
    // Wait for the extension's push to land: a revision beyond the injected one, carrying the rename.
    const manifest = await pollUntil(async (): Promise<DecryptedManifest | undefined> => {
      const { manifest: m, root } = await openLatestManifest(baseApiUrl, user.token!.token, user.encryptionKey!);
      const renamed = (m.tables.Items ?? []).some((row) => row.Name === renamedCredentialName);
      return root.revision > injectedRevision && renamed ? m : undefined;
    });

    // The unknown column re-attached to the row the extension itself rewrote (rename bumps the row).
    const item = (manifest.tables.Items ?? []).find((row) => row.Name === renamedCredentialName);
    expect(item, 'renamed credential row should be present').toBeTruthy();
    expect(item!.AliasEnabled, 'unknown column must survive the old-client push').toBe(true);

    // The unknown table re-emitted verbatim.
    expect(manifest.tables.FutureFeatures, 'unknown table must survive the old-client push').toEqual([futureTableRow]);
  });
});

/**
 * Polls until the server snapshot is manifest-v1, then decrypts and returns its root manifest.
 *
 * @param apiUrl - The base URL of the API
 * @param token - Bearer token
 * @param encryptionKey - The user's derived vault encryption key
 * @returns The decrypted manifest and its snapshot entry
 */
async function openLatestManifest(apiUrl: string, token: string, encryptionKey: Uint8Array): Promise<{ manifest: DecryptedManifest; root: ReturnType<typeof requireRootManifest> }> {
  return pollUntil(async () => {
    const snapshot = await getVaultSnapshot(apiUrl, token);
    const root = requireRootManifest(snapshot);
    return { manifest: await openManifest(root.blob, encryptionKey), root };
  });
}
