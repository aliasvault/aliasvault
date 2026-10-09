import { StorageKeys } from '../constants/StorageKeys';

import { getPlatform } from './ClientPlatform';

/**
 * The random id of this install, created on first use. Per-device vault rows (item usage statistics) are keyed by it.
 * @returns The lowercase device id
 */
export async function getOrCreateDeviceId(): Promise<string> {
  const storage = getPlatform().storage;
  const stored = await storage.get<string>(StorageKeys.DEVICE_ID);
  if (stored) {
    return stored;
  }
  const deviceId = crypto.randomUUID().toLowerCase();
  await storage.set(StorageKeys.DEVICE_ID, deviceId);
  return deviceId;
}
