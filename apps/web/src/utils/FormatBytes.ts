/**
 * Format a byte count for display, e.g. "3.9 MB".
 * @param bytes - the byte count
 */
export const formatBytes = (bytes: number): string => {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return unitIndex === 0 ? `${Math.round(size)} ${units[unitIndex]}` : `${(Math.round(size * 10) / 10).toString()} ${units[unitIndex]}`;
};
