/*
 * Drops one known, harmless library warning in development. sonner-native 0.27 and react-native-draggable-flatlist 4.0
 * pass dependency arrays to Reanimated hooks, which Reanimated 4 ignores on native and warns about once per call site.
 * Remove an entry once the libraries stop passing them.
 */

/** Start of each ignored warning. */
const IGNORED_WARNINGS = ['[Reanimated] Dependencies should only be used on the web'];

if (__DEV__) {
  const warn = console.warn;
  console.warn = (...args: unknown[]): void => {
    const [message] = args;
    if (typeof message === 'string' && IGNORED_WARNINGS.some((prefix) => message.startsWith(prefix))) {
      return;
    }
    warn(...args);
  };
}
