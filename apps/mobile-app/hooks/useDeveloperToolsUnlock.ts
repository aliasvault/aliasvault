import { useCallback, useEffect, useRef, useState } from 'react';
import Toast from 'react-native-toast-message';

import { DeveloperToolsService } from '@/services/DeveloperToolsService';

/**
 * Taps needed on the settings logo or version footer to reveal the developer tools.
 */
const REQUIRED_TAPS = 20;

/**
 * How long a tap sequence stays alive.
 */
const TAP_TIMEOUT_MS = 3000;

type DeveloperToolsUnlock = {
  isEnabled: boolean;
  registerTap: () => void;
  refresh: () => void;
};

/**
 * Hook that reveals the hidden developer tools after tapping an unlock target often enough.
 */
export function useDeveloperToolsUnlock(): DeveloperToolsUnlock {
  const [isEnabled, setIsEnabled] = useState(false);
  const tapCount = useRef(0);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback((): void => {
    DeveloperToolsService.isEnabled().then(setIsEnabled);
  }, []);

  useEffect(() => {
    refresh();

    return (): void => {
      if (resetTimer.current) {
        clearTimeout(resetTimer.current);
      }
    };
  }, [refresh]);

  const registerTap = useCallback((): void => {
    if (isEnabled) {
      return;
    }

    if (resetTimer.current) {
      clearTimeout(resetTimer.current);
    }
    resetTimer.current = setTimeout(() => {
      tapCount.current = 0;
    }, TAP_TIMEOUT_MS);

    tapCount.current += 1;
    const tapsLeft = REQUIRED_TAPS - tapCount.current;

    if (tapsLeft > 0) {
      return;
    }

    tapCount.current = 0;

    DeveloperToolsService.setEnabled(true).then(() => {
      setIsEnabled(true);
      Toast.show({
        type: 'success',
        text1: 'Developer tools enabled',
        position: 'bottom',
        visibilityTime: 2000,
      });
    });
  }, [isEnabled]);

  return { isEnabled, registerTap, refresh };
}
