import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

/**
 * A read-only ZIP archive held in memory.
 */
export class ZipArchive {
  /**
   * Wrap the extracted files.
   * @param files - File paths to file data
   */
  private constructor(private readonly files: Map<string, Uint8Array>) {}

  /**
   * Open a ZIP archive.
   * @param bytes - The archive bytes
   * @returns The archive
   * @throws When the bytes are not a valid ZIP archive.
   */
  public static open(bytes: Uint8Array): ZipArchive {
    return new ZipArchive(new Map(Object.entries(unzipSync(bytes)).filter(([path]) => !path.endsWith('/'))));
  }

  /**
   * Whether the archive holds a file.
   * @param path - The path inside the archive
   * @returns True when present
   */
  public has(path: string): boolean {
    return this.files.has(path);
  }

  /**
   * Read a file as UTF-8 text without a byte order mark.
   * @param path - The path inside the archive
   * @returns The text, or null when the archive has no such file
   */
  public readText(path: string): string | null {
    const data = this.files.get(path);
    if (!data) {
      return null;
    }
    const text = strFromU8(data);
    return text.charCodeAt(0) === 0xFEFF ? text.substring(1) : text;
  }

  /**
   * Every file whose path starts with the prefix, compared case-insensitively.
   * @param prefix - The path prefix (e.g. "attachments/")
   * @returns File paths to file data
   */
  public filesUnder(prefix: string): Map<string, Uint8Array> {
    const lowerPrefix = prefix.toLowerCase();
    return new Map([...this.files].filter(([path]) => path.toLowerCase().startsWith(lowerPrefix)));
  }
}

/**
 * Build a ZIP archive from files keyed by path.
 * @param files - The files to include
 * @returns The archive bytes
 */
export function createZipArchive(files: Record<string, Uint8Array>): Uint8Array {
  return zipSync(files);
}

/**
 * Encode text as UTF-8 bytes for a ZIP entry.
 * @param text - The text
 * @returns The bytes
 */
export function textToZipBytes(text: string): Uint8Array {
  return strToU8(text);
}
