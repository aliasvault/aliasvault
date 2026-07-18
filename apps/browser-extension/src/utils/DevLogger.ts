/**
 * Log a timestamped trace message for debugging. Only logs in dev builds.
 */
export function devLog(message: string, ...args: unknown[]): void {
  if (!import.meta.env.DEV) {
    return;
  }
  const time = new Date().toISOString().slice(11, 23);
  console.info(`[${time}] ${message}`, ...args);
}
