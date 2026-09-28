/**
 * Hand bytes to the browser as a file download.
 * @param filename - the name the file is saved as
 * @param bytes - the file contents
 * @param mimeType - the content type, octet-stream when unknown
 */
export function downloadBytes(filename: string, bytes: Uint8Array | number[], mimeType: string | null = null): void {
  const data = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  const blob = new Blob([data as BlobPart], { type: mimeType ?? 'application/octet-stream' });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // The browser reads the URL after click() returns, so revoking it right away can drop the download silently.
  setTimeout(() => window.URL.revokeObjectURL(url), 10000);
}
