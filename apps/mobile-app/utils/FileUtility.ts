import { Directory, File } from 'expo-file-system';

/*
 * Sanitize filenames for attachments so they are accepted by mobile OS filesystems.
 * E.g. Android turns the URI into a java.net.URI, which rejects characters that are legal 
 * on disk but not in a URI path (square brackets, braces, pipes, quotes).
 */

const FALLBACK_FILENAME = 'attachment';

/**
 * Checks whether a character can stay in a single path segment.
 */
const isSafeFilenameChar = (char: string): boolean => {
  const code = char.charCodeAt(0);
  return code > 31 && code !== 127 && char !== '/' && char !== '\\';
};

/**
 * Reduces an untrusted filename to a single path segment.
 */
const sanitizeFilename = (filename: string): string => {
  const sanitized = Array.from(filename).map((char: string): string => isSafeFilenameChar(char) ? char : '_').join('').trim();
  return sanitized.length > 0 && !/^\.+$/.test(sanitized) ? sanitized : FALLBACK_FILENAME;
};

/**
 * Creates a file reference for an untrusted filename inside a directory, without creating it on disk.
 * @param directory The directory to place the file in.
 * @param filename The filename as provided by the attachment or the file picker.
 * @returns The file reference.
 */
export const getFileForFilename = (directory: Directory, filename: string): File => {
  const directoryUri = directory.uri.endsWith('/') ? directory.uri : `${directory.uri}/`;
  return new File(`${directoryUri}${encodeURIComponent(sanitizeFilename(filename))}`);
};
