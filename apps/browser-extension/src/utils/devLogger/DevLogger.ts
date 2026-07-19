/**
 * Dev-only, channel-scoped console logging.
 *
 * Every trace carries a channel tag as its first bracketed token and allows to
 * focus traces on one subsystem and mute the rest.
 *
 * Which channels are shown is decided by an optional, gitignored `devlog.local.ts`
 * file: copy `devlog.local.example.ts` to `devlog.local.ts`, edit it, and restart the
 * dev server. With no such file, every channel is shown.
 */

/**
 * A channel filter. `only` is an allowlist (when non-empty, ONLY these channels log);
 * `mute` is a denylist applied afterwards. Channel names are matched case-insensitively
 * and without the surrounding brackets (e.g. `'V2Push'`, not `'[V2Push]'`).
 */
export type DevLogFilter = {
  /** Allowlist. When present and non-empty, only these channels are shown. */
  only?: string[];
  /** Denylist. These channels are never shown (applied after `only`). */
  mute?: string[];
};

type LocalConfigModule = { default?: DevLogFilter; devLogFilter?: DevLogFilter };

/*
 * Optionally pull in the gitignored `devlog.local.ts`.
 */
const localConfigModules = import.meta.glob<LocalConfigModule>('./devlog.local.{ts,js}', { eager: true });
const firstLocalConfig = Object.values(localConfigModules)[0];
const fileFilter: DevLogFilter = firstLocalConfig?.default ?? firstLocalConfig?.devLogFilter ?? {};

/**
 * Pull the channel name out of a message's leading `[Tag]`. Returns `''` for an 
 * unchannelled message (no leading bracket), those are always shown.
 * @param message - the log message
 */
function parseChannel(message: string): string {
  const match = /^\s*\[([^\]]+)\]/.exec(message);
  return match ? match[1] : '';
}

/**
 * Whether a channel should be shown under the currently active filter.
 * @param channel - channel name (without brackets); `''` (unchannelled) is always shown
 */
function isChannelEnabled(channel: string): boolean {
  if (!channel) {
    return true;
  }
  const ch = channel.toLowerCase();
  const only = (fileFilter.only ?? []).map(c => c.toLowerCase());
  const mute = (fileFilter.mute ?? []).map(c => c.toLowerCase());
  if (only.length > 0 && !only.includes(ch)) {
    return false;
  }
  return !mute.includes(ch);
}

/**
 * Emit a channel-filtered, timestamped dev trace.
 * @param level - console method to use
 * @param message - the message (should start with a `[Channel]` tag)
 * @param args - additional console arguments
 */
function emit(level: 'info' | 'warn' | 'error', message: string, args: unknown[]): void {
  if (!import.meta.env.DEV) {
    return;
  }
  if (!isChannelEnabled(parseChannel(message))) {
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
