import { FieldTypes, ItemTypes } from '@aliasvault/models/vault';
import { gunzipSync } from 'fflate';

import { buildOtpAuthUri } from '../../../../items/OtpAuthUri';
import { base64ToBytes, base64UrlToBytes } from '../../../../utilities/Base64';
import { fromUnixTimeSeconds, parseDateTime } from '../../../shared/DateTimeUtils';
import { isBlank } from '../../../shared/StringUtils';
import { ImportException, ImportStage } from '../../models/ImportException';
import { addAttachment, addCustomField, convertArchiveItems } from '../../readers/ArchiveImport';
import { addPasskeys, buildPasskey, rustPasskeyKeys, type PasskeyKeyConverter, type PendingPasskeys } from '../../readers/PasskeyImport';
import { readXml, xmlChild, xmlChildren, xmlChildText, type XmlElement } from '../../readers/XmlReader';

import type { ImportedCredential } from '../../models/ImportedCredential';
import type { ImportedPasskey } from '../../models/ImportedPasskey';
import type { ImportFileResult } from '../../models/ImportFileResult';
import type { JsonObject } from '../../readers/JsonReader';

/** The fields every entry has. */
const STANDARD_FIELDS = new Set(['Title', 'UserName', 'Password', 'URL', 'Notes']);

/** Fields that never become custom fields: TOTP, HOTP, passkey, URL and plugin settings. */
const RESERVED_FIELDS = new Set(['otp', 'TOTP Seed', 'TOTP Settings', 'KPXC_PASSKEY_USERNAME', 'KeePassXC-Browser Settings', 'KeePassHttp Settings', '_EXEC_CMD']);
const RESERVED_FIELD_PREFIXES = ['TimeOtp-', 'HmacOtp-', 'KP2A_URL', 'KPEX_PASSKEY_'];

/** Additional URLs: KP2A_URL, KP2A_URL_1, KP2A_URL_2, ... */
const ADDITIONAL_URL_PATTERN = /^KP2A_URL(?:_(\d+))?$/;

/** Seconds from 0001-01-01 (the KDBX 4 epoch) to the Unix epoch. */
const KDBX_EPOCH_OFFSET_SECONDS = 62135596800;

/** The "TOTP Settings" digits value of a Steam code, which AliasVault cannot generate. */
const STEAM_TOTP_DIGITS = 'S';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** A bare Base32 secret in the "otp" field (KeeWeb). */
const BASE32_PATTERN = /^[A-Z2-7]+=*$/i;

/**
 * A field of an entry.
 */
type KeePassField = {
  Value: string;
  Protected: boolean;
};

/**
 * An entry with the path of the group it is in.
 */
type KeePassEntry = {
  Element: XmlElement;
  FolderPath: string | null;
};

/**
 * Import a KeePass XML export. Groups become folders; the recycle bin is skipped.
 * @param fileContent - The XML file content
 * @param keys - Converts passkey keys, the Rust core by default
 * @returns The credentials and the entries that could not be read
 * @throws {ImportException} When the file is not a KeePass XML export.
 */
export async function importKeePassXml(fileContent: string, keys: PasskeyKeyConverter = rustPasskeyKeys): Promise<ImportFileResult> {
  let document: XmlElement;
  try {
    document = readXml(fileContent);
  } catch (error) {
    throw new ImportException(ImportStage.Parse, `Failed to parse the KeePass XML export: ${error instanceof Error ? error.message : String(error)}`, error);
  }
  const rootGroup = xmlChild(xmlChild(document, 'Root'), 'Group');
  if (document.Name !== 'KeePassFile' || !rootGroup) {
    throw new ImportException(ImportStage.Parse, 'The file is not a KeePass XML export.');
  }

  const meta = xmlChild(document, 'Meta');
  const binaries = readBinaryPool(meta);
  const entries: KeePassEntry[] = [];
  collectEntries(rootGroup, null, xmlChildText(meta, 'RecycleBinUUID'), entries);

  const pendingPasskeys: PendingPasskeys[] = [];
  const result = convertArchiveItems(entries, (entry, index) => {
    const fields = readFields(entry.Element);
    const credential = convertEntry(entry, fields, binaries);
    const passkey = readPasskeyFields(fields);
    if (passkey) {
      pendingPasskeys.push({ Credential: credential, Index: index, Passkeys: [passkey] });
    }
    return credential;
  }, entry => readFields(entry.Element).get('Title')?.Value ?? null);

  return addPasskeys(result, pendingPasskeys, passkey => readPasskey(passkey, keys));
}

/**
 * Collect the entries of a group and its subgroups, except the recycle bin.
 * @param group - The group
 * @param folderPath - The folder path of the group, or null for the root group
 * @param recycleBinUuid - The UUID of the recycle bin group, if any
 * @param entries - Receives the entries
 */
function collectEntries(group: XmlElement, folderPath: string | null, recycleBinUuid: string | null, entries: KeePassEntry[]): void {
  for (const entry of xmlChildren(group, 'Entry')) {
    entries.push({ Element: entry, FolderPath: folderPath });
  }
  for (const subgroup of xmlChildren(group, 'Group')) {
    if (!isBlank(recycleBinUuid) && xmlChildText(subgroup, 'UUID') === recycleBinUuid) {
      continue;
    }
    const name = xmlChildText(subgroup, 'Name')?.trim() || '-';
    collectEntries(subgroup, folderPath ? `${folderPath}/${name}` : name, recycleBinUuid, entries);
  }
}

/**
 * The attachments in Meta/Binaries by ID. KeePassXC only writes this pool for KDBX 3 databases.
 * @param meta - The Meta element
 * @returns The attachments by ID
 */
function readBinaryPool(meta: XmlElement | null): Map<string, Uint8Array> {
  const pool = new Map<string, Uint8Array>();
  for (const binary of xmlChildren(xmlChild(meta, 'Binaries'), 'Binary')) {
    const id = binary.Attributes.ID;
    if (id !== undefined) {
      pool.set(id, decodeBinary(binary));
    }
  }
  return pool;
}

/**
 * The bytes of a Binary element (base64, gzipped when Compressed="True").
 * @param binary - The element
 * @returns The bytes
 */
function decodeBinary(binary: XmlElement): Uint8Array {
  const bytes = base64ToBytes(binary.Text.replace(/\s/g, ''));
  return binary.Attributes.Compressed === 'True' ? gunzipSync(bytes) : bytes;
}

/**
 * The fields of an entry by name.
 * @param entry - The Entry element
 * @returns The fields
 */
function readFields(entry: XmlElement): Map<string, KeePassField> {
  const fields = new Map<string, KeePassField>();
  for (const field of xmlChildren(entry, 'String')) {
    const key = xmlChildText(field, 'Key');
    const value = xmlChild(field, 'Value');
    if (key !== null && value) {
      fields.set(key, { Value: value.Text, Protected: value.Attributes.ProtectInMemory === 'True' || value.Attributes.Protected === 'True' });
    }
  }
  return fields;
}

/**
 * Convert an entry to a credential.
 * @param entry - The entry
 * @param fields - Its fields
 * @param binaries - The attachment pool
 * @returns The credential
 */
function convertEntry(entry: KeePassEntry, fields: Map<string, KeePassField>, binaries: Map<string, Uint8Array>): ImportedCredential {
  /**
   * The value of a field, or null when it is empty or missing.
   * @param name - The field name
   * @returns The value
   */
  const text = (name: string): string | null => {
    const value = fields.get(name)?.Value;
    return value ? value : null;
  };
  const times = xmlChild(entry.Element, 'Times');
  const urls = readUrls(fields);
  const credential: ImportedCredential = {
    ServiceName: text('Title'),
    Username: text('UserName'),
    Password: text('Password'),
    Notes: text('Notes'),
    FolderPath: entry.FolderPath,
    CreatedAt: readDate(xmlChildText(times, 'CreationTime')),
    UpdatedAt: readDate(xmlChildText(times, 'LastModificationTime')),
    TwoFactorSecret: readTotp(fields),
  };
  if (urls.length > 0) {
    credential.ServiceUrls = urls;
  }
  const isNote = !credential.Username && !credential.Password && urls.length === 0 && !credential.TwoFactorSecret && !fields.has('KPEX_PASSKEY_PRIVATE_KEY_PEM');
  credential.ItemType = isNote ? ItemTypes.Note : ItemTypes.Login;

  for (const [name, field] of fields) {
    if (!STANDARD_FIELDS.has(name) && !RESERVED_FIELDS.has(name) && !RESERVED_FIELD_PREFIXES.some(prefix => name.startsWith(prefix))) {
      addCustomField(credential, name, field.Value, field.Protected ? FieldTypes.Hidden : FieldTypes.Text);
    }
  }

  for (const binary of xmlChildren(entry.Element, 'Binary')) {
    const name = xmlChildText(binary, 'Key');
    const value = xmlChild(binary, 'Value');
    const ref = value?.Attributes.Ref;
    const data = ref !== undefined ? binaries.get(ref) : value && value.Text.trim().length > 0 ? decodeBinary(value) : undefined;
    if (!isBlank(name) && data) {
      addAttachment(credential, name, data);
    }
  }
  return credential;
}

/**
 * The URL of an entry followed by its additional URLs in order.
 * @param fields - The fields
 * @returns The URLs
 */
function readUrls(fields: Map<string, KeePassField>): string[] {
  const additional = [...fields.entries()]
    .map(([name, field]) => ({ match: ADDITIONAL_URL_PATTERN.exec(name), url: field.Value.trim() }))
    .filter(({ match, url }) => match && url.length > 0)
    .sort((a, b) => Number(a.match![1] ?? 0) - Number(b.match![1] ?? 0))
    .map(({ url }) => url);
  const url = fields.get('URL')?.Value.trim();
  return [...(url ? [url] : []), ...additional];
}

/**
 * Read a date: base64 seconds since 0001-01-01 (KDBX 4) or ISO 8601.
 * @param value - The text
 * @returns The date, or null
 */
function readDate(value: string | null): Date | null {
  if (isBlank(value)) {
    return null;
  }
  if (/^[A-Za-z0-9+/]{11}=$/.test(value)) {
    const bytes = base64ToBytes(value);
    const seconds = Number(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigInt64(0, true));
    return fromUnixTimeSeconds(seconds - KDBX_EPOCH_OFFSET_SECONDS);
  }
  return parseDateTime(value);
}

/**
 * The TOTP code from "TOTP Seed" (KeeTrayTOTP), "otp" or the KeePass 2 TimeOtp-* fields, in that order.
 * @param fields - The fields
 * @returns The TOTP code, or null when the entry has none or only a Steam code
 */
function readTotp(fields: Map<string, KeePassField>): string | null {
  /**
   * The trimmed value of a field, empty when it is missing.
   * @param name - The field name
   * @returns The value
   */
  const value = (name: string): string => fields.get(name)?.Value.trim() ?? '';

  const seed = value('TOTP Seed');
  if (seed) {
    const [period, digits] = value('TOTP Settings').split(';');
    if (digits === STEAM_TOTP_DIGITS) {
      return null;
    }
    return buildOtpAuthUri('', seed, '', { Period: Number(period) || undefined, Digits: Number(digits) || undefined });
  }

  const otp = value('otp');
  if (otp.toLowerCase().startsWith('otpauth://') || BASE32_PATTERN.test(otp)) {
    return otp;
  }
  if (otp) {
    const query = new URLSearchParams(otp);
    const key = query.get('key');
    return key ? buildOtpAuthUri('', key, '', { Period: Number(query.get('step')) || undefined, Digits: Number(query.get('size')) || undefined, Algorithm: query.get('otpHashMode') ?? undefined }) : null;
  }

  const secret = readTimeOtpSecret(fields);
  if (secret) {
    return buildOtpAuthUri('', secret, '', { Period: Number(value('TimeOtp-Period')) || undefined, Digits: Number(value('TimeOtp-Length')) || undefined, Algorithm: value('TimeOtp-Algorithm').replace(/^HMAC-/i, '') || undefined });
  }
  return null;
}

/**
 * The KeePass 2 TOTP secret as Base32.
 * @param fields - The fields
 * @returns The Base32 secret, or null
 */
function readTimeOtpSecret(fields: Map<string, KeePassField>): string | null {
  /**
   * The value of a field with its spaces removed.
   * @param name - The field name
   * @returns The value
   */
  const compact = (name: string): string => fields.get(name)?.Value.replace(/\s/g, '') ?? '';
  const base32 = compact('TimeOtp-Secret-Base32');
  if (base32) {
    return base32;
  }
  const hex = compact('TimeOtp-Secret-Hex');
  if (/^(?:[0-9a-f]{2})+$/i.test(hex)) {
    return bytesToBase32(Uint8Array.from(hex.match(/../g)!, pair => parseInt(pair, 16)));
  }
  const base64 = compact('TimeOtp-Secret-Base64');
  if (base64) {
    return bytesToBase32(base64ToBytes(base64));
  }
  const text = fields.get('TimeOtp-Secret')?.Value;
  return text ? bytesToBase32(new TextEncoder().encode(text)) : null;
}

/**
 * Encode bytes as unpadded Base32 (RFC 4648).
 * @param bytes - The bytes
 * @returns The Base32 text
 */
function bytesToBase32(bytes: Uint8Array): string {
  let output = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return bits > 0 ? output + BASE32_ALPHABET[(buffer << (5 - bits)) & 31] : output;
}

/**
 * The passkey fields of an entry. Strongbox's own credential id and user name fields come first, as in KeePassXC.
 * @param fields - The fields
 * @returns The passkey fields, or null when the entry has no passkey
 */
function readPasskeyFields(fields: Map<string, KeePassField>): JsonObject | null {
  /**
   * The trimmed value of the first of these fields that has one.
   * @param names - The field names in order of preference
   * @returns The value, or null
   */
  const value = (...names: string[]): string | null => names.map(name => fields.get(name)?.Value.trim()).find(text => !isBlank(text)) ?? null;
  const privateKey = value('KPEX_PASSKEY_PRIVATE_KEY_PEM');
  if (!privateKey) {
    return null;
  }
  return {
    privateKey,
    credentialId: value('KPEX_PASSKEY_GENERATED_USER_ID', 'KPEX_PASSKEY_CREDENTIAL_ID'),
    userHandle: value('KPEX_PASSKEY_USER_HANDLE'),
    userName: value('KPXC_PASSKEY_USERNAME', 'KPEX_PASSKEY_USERNAME'),
    rpId: value('KPEX_PASSKEY_RELYING_PARTY'),
  };
}

/**
 * Read a passkey (PKCS#8 PEM key, base64url credential id and user handle).
 * @param passkey - The passkey fields
 * @param keys - Converts the key
 * @returns The passkey
 * @throws {ImportException} When the key is not PEM or a field is missing.
 */
async function readPasskey(passkey: JsonObject, keys: PasskeyKeyConverter): Promise<ImportedPasskey> {
  const pem = /-----BEGIN PRIVATE KEY-----([\s\S]+?)-----END PRIVATE KEY-----/.exec(String(passkey.privateKey));
  if (!pem || isBlank(passkey.credentialId as string | null)) {
    throw new ImportException(ImportStage.Parse, 'A KeePass passkey needs a PKCS#8 private key and a credential id');
  }
  const userHandle = passkey.userHandle as string | null;
  return buildPasskey({
    RpId: passkey.rpId as string | null,
    CredentialId: base64UrlToBytes(passkey.credentialId as string),
    UserHandle: isBlank(userHandle) ? null : base64UrlToBytes(userHandle),
    Keys: await keys.fromPkcs8(base64ToBytes(pem[1].replace(/\s/g, ''))),
    DisplayNames: [passkey.userName as string | null],
  });
}
