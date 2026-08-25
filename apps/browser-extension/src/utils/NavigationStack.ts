import type { NavigationHistoryEntry } from '@/utils/NavigationStateService';

/**
 * How many entries of the navigation stack are kept, which bounds how deep a restore replays.
 */
export const MAX_HISTORY_ENTRIES = 10;

/**
 * How the router got to the current page, mirroring react-router's navigation type.
 */
export type NavigationAction = 'POP' | 'PUSH' | 'REPLACE';

/**
 * The pages visited in this popup, in order, plus the restore that is still replaying onto it.
 */
export type NavigationStackState = {
  stack: NavigationHistoryEntry[];
  replay: NavigationHistoryEntry[] | null;
  replayCursor: number;
};

/**
 * Whether two entries point at the same page.
 * @param a - First entry
 * @param b - Second entry
 */
const isSamePage = (a: NavigationHistoryEntry | null | undefined, b: NavigationHistoryEntry): boolean => {
  return a?.pathname === b.pathname && a?.search === b.search;
};

/**
 * An empty stack, for a popup that starts without a restored trail.
 */
export const createNavigationStack = (): NavigationStackState => ({ stack: [], replay: null, replayCursor: 0 });

/**
 * Adopt a restored trail so the stack keeps growing from where the previous popup left off.
 * @param entries - The restored entries, oldest first
 */
export const seedNavigationStack = (entries: NavigationHistoryEntry[]): NavigationStackState => {
  const stack = entries.slice(-MAX_HISTORY_ENTRIES);
  return { stack, replay: [...stack], replayCursor: 0 };
};

/**
 * Fit a page that a restore is replaying onto the seeded trail.
 * @param state - The current stack state
 * @param entry - The page that was navigated to
 * @returns The new state, or null when the page is not part of the replay
 */
const applyReplay = (state: NavigationStackState, entry: NavigationHistoryEntry): NavigationStackState | null => {
  const { replay, replayCursor } = state;
  if (!replay) {
    return null;
  }

  if (isSamePage(replay[replayCursor], entry)) {
    const cursor = replayCursor + 1;
    return { stack: replay.slice(0, cursor), replay: cursor >= replay.length ? null : replay, replayCursor: cursor };
  }

  if (isSamePage(replay[replay.length - 1], entry)) {
    return { stack: [...replay], replay: null, replayCursor: 0 };
  }

  // The user navigated somewhere the replay does not cover, so the restore is over.
  return null;
};

/**
 * Record a page visit in the navigation stack.
 * @param state - The current stack state
 * @param entry - The page that was navigated to
 * @param action - How the router got there
 */
export const trackNavigation = (state: NavigationStackState, entry: NavigationHistoryEntry, action: NavigationAction): NavigationStackState => {
  const replayed = applyReplay(state, entry);
  if (replayed) {
    return replayed;
  }

  const stack = [...state.stack];
  const top = stack.length > 0 ? stack[stack.length - 1] : null;

  if (action === 'POP') {
    // Back/forward: cut the stack back to the page that was returned to.
    let index = -1;
    for (let i = stack.length - 1; i >= 0; i--) {
      if (isSamePage(stack[i], entry)) {
        index = i;
        break;
      }
    }

    if (index === -1) {
      stack.push(entry);
    } else {
      stack.length = index + 1;
      stack[index] = entry;
    }
  } else if (top && (action === 'REPLACE' || isSamePage(top, entry))) {
    // A replace, or a re-navigation to the page already on top, updates that entry instead of stacking a second one.
    stack[stack.length - 1] = entry;
  } else {
    stack.push(entry);
  }

  if (stack.length > MAX_HISTORY_ENTRIES) {
    stack.splice(0, stack.length - MAX_HISTORY_ENTRIES);
  }

  return { stack, replay: null, replayCursor: 0 };
};
