import { FieldKey, FieldTypes } from '@aliasvault/models/vault';
import { describe, expect, it } from 'vitest';

import { detectAndRemoveDuplicates } from '../ImportDuplicateDetection';
import { convertToItem } from '../ItemConverter';
import { isEmptyEnrichment, detectItemEnrichment, type ExistingItemData, type ItemEnrichment } from '../ItemEnrichment';

import type { ImportedCredential } from '../../models/ImportedCredential';
import type { ImportedCustomField } from '../../models/ImportedCustomField';
import type { ImportedPasskey } from '../../models/ImportedPasskey';
import type { FieldType, Item } from '@aliasvault/models/vault';

const PASSKEY: ImportedPasskey = { RpId: 'example.com', PublicKey: '{}', PrivateKey: '{}', DisplayName: 'Example' };
const NOTHING: ExistingItemData = { FieldValues: [], TotpSecretKeys: [], PasskeyCount: 0, Attachments: [] };

/**
 * An imported custom text field.
 * @param label - The label
 * @param value - The value
 * @param fieldType - The field type
 * @returns The custom field
 */
function customField(label: string, value: string, fieldType: FieldType = FieldTypes.Text): ImportedCustomField {
  return { DefinitionId: label, Label: label, FieldType: fieldType, IsMultiValue: false, IsHidden: false, EnableHistory: false, Weight: 0, ValueWeight: 0, Value: value };
}

/**
 * Detect what a credential adds to an item.
 * @param existing - What the item holds
 * @param credential - The credential
 * @returns The enrichment
 */
function detect(existing: Partial<ExistingItemData>, credential: ImportedCredential): ItemEnrichment {
  return detectItemEnrichment({ ...NOTHING, ...existing }, convertToItem(credential, null));
}

describe('detectItemEnrichment', () => {
  it('adds a passkey, TOTP code and attachment the item lacks', () => {
    const enrichment = detect({}, { ServiceName: 'Example', TwoFactorSecret: 'JBSWY3DPEHPK3PXP', Passkeys: [PASSKEY], Attachments: [{ Filename: 'a.txt', Blob: new Uint8Array(3) }] });

    expect(enrichment.Passkeys).toHaveLength(1);
    expect(enrichment.TotpCodes.map(code => code.SecretKey)).toEqual(['JBSWY3DPEHPK3PXP']);
    expect(enrichment.Attachments.map(attachment => attachment.Filename)).toEqual(['a.txt']);
  });

  it('adds nothing the item already holds', () => {
    const enrichment = detect(
      { TotpSecretKeys: ['jbsw y3dp ehpk 3pxp'], PasskeyCount: 1, Attachments: [{ Filename: 'A.txt', Size: 3 }], FieldValues: [{ FieldKey: FieldKey.LoginUrl, Label: null, FieldType: null, Value: 'https://example.com/', Weight: 0 }] },
      { ServiceName: 'Example', ServiceUrls: ['https://EXAMPLE.com'], TwoFactorSecret: 'JBSWY3DPEHPK3PXP', Passkeys: [PASSKEY], Attachments: [{ Filename: 'a.txt', Blob: new Uint8Array(3) }] }
    );

    expect(isEmptyEnrichment(enrichment)).toBe(true);
  });

  it('keeps the passkey of an item that has one', () => {
    expect(detect({ PasskeyCount: 1 }, { ServiceName: 'Example', Passkeys: [PASSKEY] }).Passkeys).toEqual([]);
  });

  it('adds an attachment with a known name but another size', () => {
    const enrichment = detect({ Attachments: [{ Filename: 'a.txt', Size: 3 }] }, { ServiceName: 'Example', Attachments: [{ Filename: 'a.txt', Blob: new Uint8Array(4) }] });

    expect(enrichment.Attachments).toHaveLength(1);
  });

  it('adds only the URLs the item lacks', () => {
    const enrichment = detect(
      { FieldValues: [{ FieldKey: FieldKey.LoginUrl, Label: null, FieldType: null, Value: 'https://example.com', Weight: 0 }] },
      { ServiceName: 'Example', ServiceUrls: ['https://example.com', 'https://login.example.com', 'https://login.example.com'] }
    );

    expect(enrichment.FieldValues.map(fieldValue => fieldValue.Value)).toEqual(['https://login.example.com']);
  });

  it('fills an empty single-value field and never overwrites a filled one', () => {
    const credential: ImportedCredential = { ServiceName: 'Example', Username: 'new-user', Email: 'me@example.com' };
    const enrichment = detect({ FieldValues: [{ FieldKey: FieldKey.LoginUsername, Label: null, FieldType: null, Value: 'old-user', Weight: 0 }] }, credential);

    expect(enrichment.FieldValues.map(fieldValue => [fieldValue.FieldKey, fieldValue.Value])).toEqual([[FieldKey.LoginEmail, 'me@example.com']]);
  });

  it('appends the custom fields whose label the item lacks', () => {
    const enrichment = detect(
      { FieldValues: [{ FieldKey: null, Label: 'Security question', FieldType: FieldTypes.Text, Value: 'edited in the vault', Weight: 4 }] },
      { ServiceName: 'Example', CustomFieldValues: [customField('security QUESTION', 'from the file'), customField('Section', '', FieldTypes.Section), customField('Recovery code', '1234')] }
    );

    expect(enrichment.FieldValues.map(fieldValue => [fieldValue.FieldDefinition?.Label, fieldValue.Value, fieldValue.Weight])).toEqual([['Recovery code', '1234', 5]]);
  });

  it('gives an item without custom fields all of them, sections included', () => {
    const enrichment = detect({}, { ServiceName: 'Example', CustomFieldValues: [customField('Section', '', FieldTypes.Section), customField('Recovery code', '1234')] });

    expect(enrichment.FieldValues.map(fieldValue => fieldValue.FieldDefinition?.Label)).toEqual(['Section', 'Recovery code']);
  });
});

describe('detectAndRemoveDuplicates', () => {
  const personal = 'personal';
  const credential: ImportedCredential = { ServiceName: 'Example', Username: 'user', Password: 'secret', Passkeys: [PASSKEY], Attachments: [{ Filename: 'a.txt', Blob: new Uint8Array(3) }] };

  /**
   * A vault item matching the credential.
   * @param id - The item id
   * @param hasPasskey - Whether it holds a passkey
   * @returns The item
   */
  const vaultItem = (id: string, hasPasskey: boolean = false): Item => ({
    Id: id,
    ManifestId: personal,
    Name: 'example',
    ItemType: 'Login',
    HasPasskey: hasPasskey,
    CreatedAt: '',
    UpdatedAt: '',
    Fields: [
      { FieldKey: FieldKey.LoginUsername, Label: '', FieldType: FieldTypes.Text, Value: 'user', IsHidden: false, DisplayOrder: 0, IsCustomField: false, EnableHistory: false },
      { FieldKey: FieldKey.LoginPassword, Label: '', FieldType: FieldTypes.Password, Value: 'secret', IsHidden: true, DisplayOrder: 0, IsCustomField: false, EnableHistory: false },
    ],
  });

  /**
   * Plans against items that hold their fields and, when flagged, the passkey and attachment.
   */
  const planner = (existing: Item, imported: ImportedCredential): ItemEnrichment => detect({
    FieldValues: existing.Fields.map(field => ({ FieldKey: field.FieldKey, Label: null, FieldType: null, Value: field.Value as string, Weight: 0 })),
    PasskeyCount: existing.HasPasskey ? 1 : 0,
    Attachments: existing.HasPasskey ? [{ Filename: 'a.txt', Size: 3 }] : [],
  }, imported);

  it('imports a credential the vault does not hold', () => {
    const preview = detectAndRemoveDuplicates([], [credential], planner);

    expect(preview).toMatchObject({ credentials: [credential], enrichments: [], duplicateCount: 0, attachmentCount: 1, attachmentsTotalSize: 3 });
  });

  it('completes a matching item instead of importing it a second time', () => {
    const preview = detectAndRemoveDuplicates([vaultItem('a')], [credential], planner);

    expect(preview).toMatchObject({ credentials: [], enrichments: [{ credential, target: { Id: 'a', ManifestId: personal } }], duplicateCount: 0, attachmentCount: 1 });
  });

  it('drops a credential a matching item already holds in full', () => {
    const preview = detectAndRemoveDuplicates([vaultItem('a'), vaultItem('b', true)], [credential], planner);

    expect(preview).toMatchObject({ credentials: [], enrichments: [], duplicateCount: 1, attachmentCount: 0 });
  });

  it('completes an item once per import', () => {
    const preview = detectAndRemoveDuplicates([vaultItem('a')], [credential, { ...credential }], planner);

    expect(preview.enrichments).toHaveLength(1);
    expect(preview.duplicateCount).toBe(1);
  });

  it('treats a match that cannot be completed as a duplicate', () => {
    const preview = detectAndRemoveDuplicates([vaultItem('a')], [credential], () => null);

    expect(preview).toMatchObject({ credentials: [], enrichments: [], duplicateCount: 1 });
  });
});
