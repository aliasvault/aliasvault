/**
 * Category 12: Item Form Draft Persistence (Requires API + Authentication)
 *
 * When the user is creating/editing a credential and the popup closes (e.g. they
 * focus the main browser window to copy something), their in-progress draft is
 * backed up and restored when the popup is reopened. On reopen the popup also
 * restores its last route, so the user lands back on the add/edit form with the
 * draft intact.
 *
 * Restoring the always-visible fields already worked. These tests cover the gap
 * for conditionally-added optional sections that are hidden until the user adds
 * them via the "+" menu, in BOTH create and edit mode:
 *   - Notes (added via the add-field menu)
 *   - 2FA / TOTP add form (added via the add-field menu, while half-filled)
 */
import { test, expect, TestClient, FieldSelectors, ButtonSelectors, Timeouts } from '../fixtures';

const NOTES_DRAFT = 'Draft notes that must survive a popup reopen';
const TOTP_NAME_DRAFT = 'My Draft Authenticator';
const TOTP_SECRET_DRAFT = 'JBSWY3DPEHPK3PXP';

const TOTP_NAME_INPUT = 'input#totp-name';
const TOTP_SECRET_INPUT = 'input#totp-secret';
const TOTP_ADD_NAME_BUTTON = 'button#add-totp-name';

/**
 * Simulate the popup closing and reopening. Reloading the document tears the
 * popup down without running React unmount cleanup, exactly like a real popup
 * close, so the persisted draft must survive. The popup restores its last route,
 * so we then wait for the add/edit form (its name field) to come back.
 */
async function reopenPopupToForm(client: TestClient): Promise<void> {
  await client.popup.evaluate(() => {
    window.location.href = '/popup.html';
  });
  await client.popup.waitForLoadState('domcontentloaded');
  await expect(client.popup.locator(FieldSelectors.ITEM_NAME)).toBeVisible({ timeout: Timeouts.LONG });
}

/**
 * Add the Notes section via the "+" add-field menu and type a draft into it.
 */
async function addNotesDraft(client: TestClient, text: string): Promise<void> {
  await client.popup.locator(ButtonSelectors.ADD_FIELD_MENU).click();
  await client.popup.getByRole('button', { name: 'Notes', exact: true }).click();
  await expect(client.popup.locator(FieldSelectors.LOGIN_NOTES)).toBeVisible({ timeout: Timeouts.MEDIUM });
  await client.popup.fill(FieldSelectors.LOGIN_NOTES, text);
}

/**
 * Add the 2FA section via the "+" add-field menu and half-fill the TOTP add
 * form (name + secret) without saving the code.
 */
async function add2FADraft(client: TestClient, name: string, secret: string): Promise<void> {
  await client.popup.locator(ButtonSelectors.ADD_FIELD_MENU).click();
  await client.popup.getByRole('button', { name: 'Two-factor authentication' }).click();
  await expect(client.popup.locator(TOTP_SECRET_INPUT)).toBeVisible({ timeout: Timeouts.MEDIUM });
  await client.popup.locator(TOTP_ADD_NAME_BUTTON).click();
  await client.popup.fill(TOTP_NAME_INPUT, name);
  await client.popup.fill(TOTP_SECRET_INPUT, secret);
}

/**
 * Give the auto-persistence (async message to the background script) time to
 * flush before we tear the popup down.
 */
async function waitForPersist(client: TestClient): Promise<void> {
  await client.popup.waitForTimeout(500);
}

test.describe.serial('12. Item Form Draft Persistence', () => {
  let client: TestClient;

  test.afterAll(async () => {
    await client?.cleanup();
  });

  test('12.1 create: notes draft is restored after popup reopen', async ({ testUser, apiUrl }) => {
    client = await TestClient.create();
    await client.login(apiUrl, testUser.username, testUser.password);

    await client.goToVault();
    await client.openAddCredentialForm();
    await client.popup.fill(FieldSelectors.ITEM_NAME, 'Create Notes Draft');
    await client.popup.fill(FieldSelectors.LOGIN_USERNAME, 'create-notes-user');
    await addNotesDraft(client, NOTES_DRAFT);
    await waitForPersist(client);

    await reopenPopupToForm(client);

    // The notes section must reappear with the draft text intact.
    await expect(client.popup.locator(FieldSelectors.LOGIN_NOTES)).toBeVisible({ timeout: Timeouts.MEDIUM });
    await expect(client.popup.locator(FieldSelectors.LOGIN_NOTES)).toHaveValue(NOTES_DRAFT);
  });

  test('12.2 create: in-progress 2FA add form is restored after popup reopen', async () => {
    await client.goToVault();
    await client.openAddCredentialForm();
    await client.popup.fill(FieldSelectors.ITEM_NAME, 'Create 2FA Draft');
    await client.popup.fill(FieldSelectors.LOGIN_USERNAME, 'create-2fa-user');
    await add2FADraft(client, TOTP_NAME_DRAFT, TOTP_SECRET_DRAFT);
    await waitForPersist(client);

    await reopenPopupToForm(client);

    // The 2FA add form must reappear with the half-entered values intact.
    await expect(client.popup.locator(TOTP_SECRET_INPUT)).toBeVisible({ timeout: Timeouts.MEDIUM });
    await expect(client.popup.locator(TOTP_NAME_INPUT)).toHaveValue(TOTP_NAME_DRAFT);
    await expect(client.popup.locator(TOTP_SECRET_INPUT)).toHaveValue(TOTP_SECRET_DRAFT);
  });

  test('12.3 edit: notes draft added to an existing item is restored after popup reopen', async () => {
    // Start from a saved credential that has no notes.
    await client.goToVault();
    await client.createCredential('Edit Notes Target', 'edit-notes-user', 'EditPass123!');

    await client.goToVault();
    await client.clickCredential('Edit Notes Target');
    await client.openEditForm();
    await addNotesDraft(client, NOTES_DRAFT);
    await waitForPersist(client);

    await reopenPopupToForm(client);

    await expect(client.popup.locator(FieldSelectors.LOGIN_NOTES)).toBeVisible({ timeout: Timeouts.MEDIUM });
    await expect(client.popup.locator(FieldSelectors.LOGIN_NOTES)).toHaveValue(NOTES_DRAFT);
  });

  test('12.4 edit: in-progress 2FA add form added to an existing item is restored after popup reopen', async () => {
    await client.goToVault();
    await client.createCredential('Edit 2FA Target', 'edit-2fa-user', 'EditPass123!');

    await client.goToVault();
    await client.clickCredential('Edit 2FA Target');
    await client.openEditForm();
    await add2FADraft(client, TOTP_NAME_DRAFT, TOTP_SECRET_DRAFT);
    await waitForPersist(client);

    await reopenPopupToForm(client);

    await expect(client.popup.locator(TOTP_SECRET_INPUT)).toBeVisible({ timeout: Timeouts.MEDIUM });
    await expect(client.popup.locator(TOTP_NAME_INPUT)).toHaveValue(TOTP_NAME_DRAFT);
    await expect(client.popup.locator(TOTP_SECRET_INPUT)).toHaveValue(TOTP_SECRET_DRAFT);
  });
});
