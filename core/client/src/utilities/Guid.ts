/**
 * The 16 bytes of a GUID, in the order it is written.
 * @param guid - The GUID text
 * @returns The bytes, or null when the text is not a GUID
 */
export function guidToBytes(guid: string): Uint8Array | null {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(guid)) {
    return null;
  }
  const hex = guid.replace(/-/g, '');
  return Uint8Array.from({ length: 16 }, (_, index) => parseInt(hex.substring(index * 2, index * 2 + 2), 16));
}
