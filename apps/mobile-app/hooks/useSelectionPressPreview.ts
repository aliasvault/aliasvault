import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

/** How long a touch rests before its row shows the new state; the native delay that tells a tap from a scroll. */
const PREVIEW_DELAY_MS = Platform.OS === 'ios' ? 150 : 100;

/**
 * The selection state a row shows while a finger rests on it in selection mode; the tap commits on release.
 * @param selectionMode - whether the list is in selection mode
 * @param isSelected - whether the row is selected
 */
export function useSelectionPressPreview(selectionMode: boolean, isSelected: boolean): { shownSelected: boolean; onPressIn: () => void; onPressOut: () => void } {
  const [pendingSelected, setPendingSelected] = useState<boolean | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback((): void => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => clearTimer, [clearTimer]);

  const onPressIn = useCallback((): void => {
    if (!selectionMode) {
      return;
    }
    clearTimer();
    const target = !isSelected;
    timerRef.current = setTimeout(() => setPendingSelected(target), PREVIEW_DELAY_MS);
  }, [selectionMode, isSelected, clearTimer]);

  const onPressOut = useCallback((): void => {
    clearTimer();
    setPendingSelected(null);
  }, [clearTimer]);

  return { shownSelected: pendingSelected ?? isSelected, onPressIn, onPressOut };
}
