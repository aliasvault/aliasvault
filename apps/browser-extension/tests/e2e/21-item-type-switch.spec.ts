/**
 * Category 21: Item Type Switch (Requires API + Authentication)
 *
 * Switching the type of a new item hides the fields the new type does not have. Switching back,
 * also via other types, must bring their values back.
 */
import { test, expect, TestClient, FieldSelectors, ButtonSelectors, waitForCredentialSaved } from '../fixtures';

test.describe.serial('21. Item Type Switch', () => {
  let client: TestClient;
  const itemName = `Type Switch ${Date.now()}`;

  test.afterAll(async () => {
    await client?.cleanup();
  });

  test('21.1 should login', async ({ testUser, apiUrl }) => {
    client = await TestClient.create();
    await client.login(apiUrl, testUser.username, testUser.password);
  });

  test('21.2 should restore fields after switching the item type back', async () => {
    const { popup } = client;

    await test.step('create an alias and fill in the alias fields', async () => {
      await client.goToVault().then((c) => c.openAddCredentialForm(ButtonSelectors.ADD_ITEM_TYPE_ALIAS));
      // Wait for the random alias generated on open, so it does not overwrite the values filled in below.
      await expect(popup.locator(FieldSelectors.ALIAS_FIRST_NAME)).not.toHaveValue('');
      await popup.fill(FieldSelectors.ITEM_NAME, itemName);
      await popup.fill(FieldSelectors.ALIAS_FIRST_NAME, 'Jane');
      await popup.fill(FieldSelectors.ALIAS_LAST_NAME, 'Switcher');
      await popup.fill(FieldSelectors.LOGIN_USERNAME, 'jswitch');
    });

    await test.step('switching to login drops the alias fields only', async () => {
      await client.switchItemType('Login');
      await expect(popup.locator(FieldSelectors.ALIAS_FIRST_NAME)).toHaveCount(0);
      await expect(popup.locator(FieldSelectors.LOGIN_USERNAME)).toHaveValue('jswitch');
    });

    await test.step('switching to note drops the login fields', async () => {
      await client.switchItemType('Note');
      await expect(popup.locator(FieldSelectors.LOGIN_USERNAME)).toHaveCount(0);
    });

    await test.step('switching back to alias restores every field', async () => {
      await client.switchItemType('Alias');
      await expect(popup.locator(FieldSelectors.ALIAS_FIRST_NAME)).toHaveValue('Jane');
      await expect(popup.locator(FieldSelectors.ALIAS_LAST_NAME)).toHaveValue('Switcher');
      await expect(popup.locator(FieldSelectors.LOGIN_USERNAME)).toHaveValue('jswitch');
    });

    await test.step('the restored fields are saved', async () => {
      await popup.click(ButtonSelectors.SAVE);
      await waitForCredentialSaved(popup, itemName);
      await client.goToVault().then((c) => c.clickCredential(itemName)).then((c) => c.openEditForm());
      await expect(popup.locator(FieldSelectors.ALIAS_FIRST_NAME)).toHaveValue('Jane');
      await expect(popup.locator(FieldSelectors.ALIAS_LAST_NAME)).toHaveValue('Switcher');
      await expect(popup.locator(FieldSelectors.LOGIN_USERNAME)).toHaveValue('jswitch');
    });
  });
});
