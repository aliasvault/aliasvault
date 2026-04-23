/**
 * Global vitest setup — runs once before every test file.
 *
 * Tells React this environment supports act(). Without the flag, React 18+
 * emits "The current testing environment is not configured to support act(...)"
 * on every state update inside an act(...) block. React Testing Library sets
 * this flag automatically; this codebase uses raw createRoot + act, so we
 * set it ourselves.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
