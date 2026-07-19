/**
 * Local dev-log channel filter. Copy to `devlog.local.ts` to control which dev traces are shown.
 */

import type { DevLogFilter } from './DevLogger';

const devLogFilter: DevLogFilter = {
  /**
   * Allowlist: when non-empty, only these channels are shown. Leave empty to show all.
   * Example: focus on vault sync only: only: ['V2Push', 'V2Pull', 'V2Sync']
   */
  only: [],

  /**
   * Denylist: these channels are hidden after `only` is applied.
   * Example: everything except the noisy autofill traces: mute: ['Autofill', 'FormDetector']
   */
  mute: [],
};

export default devLogFilter;
