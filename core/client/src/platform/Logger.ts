import { tryGetPlatform } from './ClientPlatform';

/**
 * Dev logging sink the host provides. Messages start with a `[Channel]` tag so the host can filter per subsystem.
 */
export interface ILogger {
  log(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

/**
 * Log a channel-scoped dev trace. Silent until the host has configured a platform.
 * @param message - the message (should start with a `[Channel]` tag)
 * @param args - additional arguments
 */
export function devLog(message: string, ...args: unknown[]): void {
  tryGetPlatform()?.logger.log(message, ...args);
}

/**
 * Like {@link devLog} at warning level.
 * @param message - the message (should start with a `[Channel]` tag)
 * @param args - additional arguments
 */
export function devWarn(message: string, ...args: unknown[]): void {
  tryGetPlatform()?.logger.warn(message, ...args);
}

/**
 * Like {@link devLog} at error level.
 * @param message - the message (should start with a `[Channel]` tag)
 * @param args - additional arguments
 */
export function devError(message: string, ...args: unknown[]): void {
  tryGetPlatform()?.logger.error(message, ...args);
}
