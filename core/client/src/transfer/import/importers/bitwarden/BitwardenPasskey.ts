import { base64UrlToBytes } from '../../../../utilities/Base64';
import { guidToBytes } from '../../../../utilities/Guid';
import { isBlank } from '../../../shared/StringUtils';
import { ImportException, ImportStage } from '../../models/ImportException';
import { readStringOrNull, type JsonObject } from '../../readers/JsonReader';
import { buildPasskey, type PasskeyKeyConverter } from '../../readers/PasskeyImport';

import type { ImportedPasskey } from '../../models/ImportedPasskey';

/** The prefix of a credential id that is not a GUID, which Bitwarden writes for passkeys it imported itself. */
const BASE64_ID_PREFIX = 'b64.';

/**
 * Read one entry of `login.fido2Credentials`, whose key is PKCS#8.
 * @param passkey - The passkey JSON
 * @param keys - Converts the key
 * @returns The passkey
 * @throws {ImportException} When the passkey lacks a field or its credential id is not a GUID.
 */
export async function readBitwardenPasskey(passkey: JsonObject, keys: PasskeyKeyConverter): Promise<ImportedPasskey> {
  const credentialId = readStringOrNull(passkey, 'credentialId');
  const key = readStringOrNull(passkey, 'keyValue');
  if (isBlank(credentialId) || isBlank(key)) {
    throw new ImportException(ImportStage.Parse, 'A Bitwarden passkey needs rpId, credentialId and keyValue');
  }
  const userHandle = readStringOrNull(passkey, 'userHandle');
  return buildPasskey({
    RpId: readStringOrNull(passkey, 'rpId'),
    CredentialId: credentialId.startsWith(BASE64_ID_PREFIX) ? base64UrlToBytes(credentialId.substring(BASE64_ID_PREFIX.length)) : guidCredentialId(credentialId),
    UserHandle: isBlank(userHandle) ? null : base64UrlToBytes(userHandle),
    Keys: await keys.fromPkcs8(base64UrlToBytes(key)),
    DisplayNames: [readStringOrNull(passkey, 'userDisplayName'), readStringOrNull(passkey, 'userName')],
  });
}

/**
 * The bytes of a credential id that Bitwarden wrote as a GUID.
 * @param credentialId - The credential id
 * @returns The bytes
 * @throws {ImportException} When the credential id is not a GUID.
 */
function guidCredentialId(credentialId: string): Uint8Array {
  const bytes = guidToBytes(credentialId);
  if (!bytes) {
    throw new ImportException(ImportStage.Parse, 'A Bitwarden passkey credentialId is not a GUID');
  }
  return bytes;
}
