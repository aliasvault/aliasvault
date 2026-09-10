import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import Toast from 'react-native-toast-message';

/**
 * Storage key for the developer tools toggle. Kept out of LocalPreferencesService on purpose:
 * that service holds account preferences that are wiped on logout, while this is a device setting.
 */
const STORAGE_KEY = 'developer_tools_enabled';

/**
 * Taps needed on the settings logo or version footer to reveal the developer tools.
 */
const REQUIRED_TAPS = 20;

/**
 * How long a tap sequence stays alive.
 */
const TAP_TIMEOUT_MS = 3000;

/**
 * Read whether the developer tools have been unlocked on this device.
 */
async function readEnabled(): Promise<boolean> {
  try {
    return await AsyncStorage.getItem(STORAGE_KEY) === 'true';
  } catch (error) {
    console.error('Failed to read developer tools state:', error);
    return false;
  }
}

/**
 * Store whether the developer tools are unlocked.
 */
async function writeEnabled(enabled: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, enabled.toString());
  } catch (error) {
    console.error('Failed to store developer tools state:', error);
  }
}

type DeveloperToolsUnlock = {
  isEnabled: boolean;
  registerTap: () => void;
  refresh: () => void;
  hide: () => Promise<void>;
};

/**
 * Hook that reveals the hidden developer tools after tapping an unlock target often enough.
 */
export function useDeveloperToolsUnlock(): DeveloperToolsUnlock {
  const [isEnabled, setIsEnabled] = useState(false);
  const tapCount = useRef(0);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback((): void => {
    readEnabled().then(setIsEnabled);
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

    writeEnabled(true).then(() => {
      setIsEnabled(true);
      Toast.show({
        type: 'success',
        text1: 'Developer tools enabled',
        position: 'bottom',
        visibilityTime: 2000,
      });
    });
  }, [isEnabled]);

  /**
   * Hide the developer tools again, putting the unlock gesture back at the start.
   */
  const hide = useCallback(async (): Promise<void> => {
    tapCount.current = 0;
    await writeEnabled(false);
    setIsEnabled(false);
  }, []);

  return { isEnabled, registerTap, refresh, hide };
}
