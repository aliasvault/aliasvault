import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { AppInfo } from '@/utils/AppInfo';

import NativeVaultManager from '@/specs/NativeVaultManager';

/**
 * Storage keys for the app review prompt state.
 */
const KEYS = {
  USE_COUNT: 'app_review_use_count',
  FIRST_SEEN_AT: 'app_review_first_seen_at',
  LAST_PROMPT_AT: 'app_review_last_prompt_at',
  LAST_PROMPT_VERSION: 'app_review_last_prompt_version',
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How long the app must have been installed before the user is asked anything.
 */
const MIN_DAYS_INSTALLED = 7;

/**
 * How many times the vault must have been opened and loaded successfully before asking.
 */
const MIN_USE_COUNT = 15;

/**
 * Minimum time between two asks.
 */
const MIN_DAYS_BETWEEN_PROMPTS = 120;

/**
 * How long to wait after the vault is ready.
 */
const PROMPT_DELAY_MS = 2500;

/**
 * Guards against counting or asking twice within a single app launch.
 */
let countedThisLaunch = false;
let promptedThisLaunch = false;

/**
 * Read a stored number, treating a missing or corrupt value as 0.
 */
async function readNumber(key: string): Promise<number> {
  const value = await AsyncStorage.getItem(key);
  const parsed = value ? parseInt(value, 10) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Get the install date, falling back to the first time this ran when the platform cannot report it.
 */
async function getInstallDate(): Promise<number> {
  const installDate = await NativeVaultManager.getAppInstallDate();
  if (installDate > 0) {
    return installDate;
  }

  const firstSeenAt = await readNumber(KEYS.FIRST_SEEN_AT);
  if (firstSeenAt > 0) {
    return firstSeenAt;
  }

  const now = Date.now();
  await AsyncStorage.setItem(KEYS.FIRST_SEEN_AT, now.toString());
  return now;
}

/**
 * Whether all conditions for asking are met.
 */
async function shouldRequestReview(): Promise<boolean> {
  const [useCount, lastPromptAt, lastPromptVersion] = await Promise.all([
    readNumber(KEYS.USE_COUNT),
    readNumber(KEYS.LAST_PROMPT_AT),
    AsyncStorage.getItem(KEYS.LAST_PROMPT_VERSION),
  ]);

  if (useCount < MIN_USE_COUNT) {
    return false;
  }

  if (lastPromptVersion === AppInfo.VERSION) {
    return false;
  }

  if (lastPromptAt > 0 && Date.now() - lastPromptAt < MIN_DAYS_BETWEEN_PROMPTS * DAY_MS) {
    return false;
  }

  return Date.now() - await getInstallDate() >= MIN_DAYS_INSTALLED * DAY_MS;
}

/**
 * Count one successful use of the app, once per launch.
 */
async function recordSuccessfulUse(): Promise<void> {
  if (countedThisLaunch) {
    return;
  }
  countedThisLaunch = true;

  try {
    const useCount = await readNumber(KEYS.USE_COUNT);
    await AsyncStorage.setItem(KEYS.USE_COUNT, (useCount + 1).toString());
  } catch (error) {
    console.error('Failed to record successful use for review prompt:', error);
  }
}

/**
 * Ask the OS to show its review prompt if all conditions are met, otherwise do nothing. Returns whether the OS accepted the request.
 */
async function maybeRequestReview(): Promise<void> {
  try {
    if (promptedThisLaunch || !await NativeVaultManager.isAppReviewAvailable()) {
      return;
    }

    if (!await shouldRequestReview()) {
      return;
    }

    promptedThisLaunch = true;

    if (await NativeVaultManager.requestAppReview()) {
      await AsyncStorage.multiSet([
        [KEYS.LAST_PROMPT_AT, Date.now().toString()],
        [KEYS.LAST_PROMPT_VERSION, AppInfo.VERSION],
      ]);
    }
  } catch (error) {
    console.error('Failed to request app review:', error);
  }
}

/**
 * Count a successful use of the app and, when it has been used enough, ask the OS to show its review prompt.
 * @param isReady - Whether the vault is unlocked and the screen has finished loading its data
 */
export function useAppReviewPrompt(isReady: boolean): void {
  useEffect(() => {
    if (!isReady) {
      return;
    }

    let cancelled = false;

    recordSuccessfulUse();

    const timer = setTimeout(async () => {
      // Do not interrupt anything the user moved on to, or ask while the app is in the background.
      if (cancelled || AppState.currentState !== 'active') {
        return;
      }

      await maybeRequestReview();
    }, PROMPT_DELAY_MS);

    return (): void => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isReady]);
}

/**
 * A snapshot of everything the decision is based on.
 */
export type AppReviewState = {
  isAvailable: boolean;
  daysInstalled: number;
  minDaysInstalled: number;
  useCount: number;
  minUseCount: number;
  daysSinceLastPrompt: number | null;
  minDaysBetweenPrompts: number;
  lastPromptVersion: string | null;
  currentVersion: string;
  meetsCriteria: boolean;
};

type AppReviewDebug = {
  state: AppReviewState | null;
  reset: () => Promise<void>;
  requestNow: () => Promise<boolean>;
};

/**
 * Hook that exposes the review state and its manual triggers for debugging purposes.
 */
export function useAppReviewDebug(): AppReviewDebug {
  const [state, setState] = useState<AppReviewState | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    const [isAvailable, useCount, lastPromptAt, lastPromptVersion, installDate, meetsCriteria] = await Promise.all([
      NativeVaultManager.isAppReviewAvailable(),
      readNumber(KEYS.USE_COUNT),
      readNumber(KEYS.LAST_PROMPT_AT),
      AsyncStorage.getItem(KEYS.LAST_PROMPT_VERSION),
      getInstallDate(),
      shouldRequestReview(),
    ]);

    setState({
      isAvailable,
      daysInstalled: Math.floor((Date.now() - installDate) / DAY_MS),
      minDaysInstalled: MIN_DAYS_INSTALLED,
      useCount,
      minUseCount: MIN_USE_COUNT,
      daysSinceLastPrompt: lastPromptAt > 0 ? Math.floor((Date.now() - lastPromptAt) / DAY_MS) : null,
      minDaysBetweenPrompts: MIN_DAYS_BETWEEN_PROMPTS,
      lastPromptVersion,
      currentVersion: AppInfo.VERSION,
      meetsCriteria,
    });
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const reset = useCallback(async (): Promise<void> => {
    countedThisLaunch = false;
    promptedThisLaunch = false;
    await AsyncStorage.multiRemove(Object.values(KEYS));
    await reload();
  }, [reload]);

  const requestNow = useCallback((): Promise<boolean> => {
    return NativeVaultManager.requestAppReview();
  }, []);

  return { state, reset, requestNow };
}
