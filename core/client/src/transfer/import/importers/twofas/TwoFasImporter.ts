import { isBlank } from '../../../shared/StringUtils';
import { ImportException, ImportStage } from '../../models/ImportException';
import { convertArchiveItems } from '../../readers/ArchiveImport';
import { parseJson, readArray, readNumber, readObject, readString, readStringAtPath, readStringOrNull, requireObject, type JsonObject } from '../../readers/JsonReader';
import { convertTwoFactorEntry } from '../../readers/TwoFactorImport';

import type { ImportedCredential } from '../../models/ImportedCredential';
import type { ImportFileResult } from '../../models/ImportFileResult';

/*
 * Note: every code becomes its own login item in the root on purpose, which the user then merges into the matching login.
 * Any group information stored in 2FAS is ignored during import.
 */

/**
 * Import a 2FAS backup (.2fas) made without a password.
 * @param fileContent - The JSON file content
 * @returns The credentials and the services that could not be imported
 * @throws {ImportException} When the file is not a 2FAS backup or the backup is password protected.
 */
export function importTwoFas(fileContent: string): ImportFileResult {
  let services: unknown[];
  try {
    services = readServices(requireObject(parseJson(fileContent), 'The 2FAS backup'));
  } catch (error) {
    if (error instanceof ImportException) {
      throw error;
    }
    throw new ImportException(ImportStage.Parse, `Failed to parse the 2FAS backup: ${error instanceof Error ? error.message : String(error)}`, error);
  }
  return convertArchiveItems(services, service => convertService(requireObject(service, 'Service')), service => readStringAtPath(service, 'name') || readStringAtPath(service, 'otp', 'issuer'));
}

/**
 * The raw services of a backup.
 * @param root - The root object
 * @returns The services
 * @throws {ImportException} When the backup is password protected or holds no services.
 */
function readServices(root: JsonObject): unknown[] {
  // A password protected backup holds its services as one encrypted string and sets "reference".
  if (!isBlank(readStringOrNull(root, 'servicesEncrypted')) || !isBlank(readStringOrNull(root, 'reference'))) {
    throw new ImportException(ImportStage.Parse, 'Password protected 2FAS backups are not supported. Please export without a password.');
  }

  const services = readArray(root, 'services');
  if (!services) {
    throw new ImportException(ImportStage.Parse, 'Failed to parse the 2FAS backup: no services found.');
  }
  return services;
}

/**
 * Convert a service to a login holding its code.
 * @param service - The service
 * @returns The credential
 */
function convertService(service: JsonObject): ImportedCredential {
  const otp = readObject(service, 'otp') ?? {};
  return convertTwoFactorEntry({
    name: readString(service, 'name') || readString(otp, 'issuer'),
    account: readString(otp, 'account'),
    type: readString(otp, 'tokenType'),
    secret: readString(service, 'secret'),
    algorithm: readString(otp, 'algorithm'),
    digits: readNumber(otp, 'digits'),
    period: readNumber(otp, 'period'),
  });
}
