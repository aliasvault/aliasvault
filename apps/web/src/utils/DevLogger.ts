/**
 * Dev-only console logging. Every trace carries a `[Channel]` tag as its first bracketed token.
 */

/**
 * Emit a timestamped dev trace, only in development builds.
 * @param level - console method to use
 * @param message - the message (should start with a `[Channel]` tag)
 * @param args - additional console arguments
 */
function emit(level: 'info' | 'warn' | 'error', message: string, args: unknown[]): void {
  if (!import.meta.env.DEV) {
    return;
  }
  const time = new Date().toISOString().slice(11, 23);
  const line = `[${time}] ${message}`;
  if (level === 'error') {
    console.error(line, ...args);
  } else if (level === 'warn') {
    console.warn(line, ...args);
  } else {
    console.info(line, ...args);
  }
}

/**
 * Log a timestamped, channel-scoped trace for debugging.
 * @param message - the message (should start with a `[Channel]` tag)
 * @param args - additional console arguments
 */
export function devLog(message: string, ...args: unknown[]): void {
  emit('info', message, args);
}

/**
 * Like {@link devLog} but at `console.warn` level.
 * @param message - the message (should start with a `[Channel]` tag)
 * @param args - additional console arguments
 */
export function devWarn(message: string, ...args: unknown[]): void {
  emit('warn', message, args);
}

/**
 * Like {@link devLog} but at `console.error` level.
 * @param message - the message (should start with a `[Channel]` tag)
 * @param args - additional console arguments
 */
export function devError(message: string, ...args: unknown[]): void {
  emit('error', message, args);
}
