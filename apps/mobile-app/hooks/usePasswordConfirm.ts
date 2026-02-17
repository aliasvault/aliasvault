import { useCallback, useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { router } from 'expo-router';

import { passwordConfirmEmitter } from '@/events/PasswordConfirmEmitter';

/**
 * Delay in ms before navigating to password confirm screen.
 * This allows the previous dialog/alert to dismiss before the modal appears.
 * iOS needs a longer delay because the native Alert has a dismiss animation.
 */
const NAVIGATION_DELAY_MS = Platform.OS === 'ios' ? 350 : 100;

type PasswordConfirmOptions = {
  /**
   * Custom description for the password confirm screen.
   * If not provided, uses default translation.
   */
  description?: string;
};

type UsePasswordConfirmReturn = {
  /**
   * Request password confirmation from the user.
   * Opens the password-confirm modal and returns a promise that resolves
   * with the password hash if confirmed, or null if cancelled.
   *
   * @param options - Optional title and description for the modal
   * @returns Promise<string | null> - Password hash (base64) or null if cancelled
   */
  requestPasswordConfirm: (options?: PasswordConfirmOptions) => Promise<string | null>;
};

/**
 * Hook for requesting password confirmation from the user.
 * Opens a modal screen where the user enters their password, which is then
 * verified before returning the password hash.
 *
 * This is useful for sensitive operations like:
 * - Exporting vault data
 * - Vault reset operations
 * - Other security-sensitive actions
 *
 * Usage:
 * ```ts
 * const { requestPasswordConfirm } = usePasswordConfirm();
 *
 * const handleSensitiveAction = async () => {
 *   const passwordHash = await requestPasswordConfirm({
 *     description: 'Enter your password to continue.',
 *   });
 *
 *   if (!passwordHash) {
 *     // User cancelled
 *     return;
 *   }
 *
 *   // Proceed with sensitive action using passwordHash
 * };
 * ```
 */
export function usePasswordConfirm(): UsePasswordConfirmReturn {
  // Store resolve function to call when we receive emitter events
  const resolveRef = useRef<((value: string | null) => void) | null>(null);

  // Subscribe to emitter events on mount
  useEffect(() => {
    const unsubscribeConfirmed = passwordConfirmEmitter.onConfirmed((passwordHash) => {
      if (resolveRef.current) {
        resolveRef.current(passwordHash);
        resolveRef.current = null;
      }
    });

    const unsubscribeCancelled = passwordConfirmEmitter.onCancelled(() => {
      if (resolveRef.current) {
        resolveRef.current(null);
        resolveRef.current = null;
      }
    });

    return () => {
      unsubscribeConfirmed();
      unsubscribeCancelled();
    };
  }, []);

  const requestPasswordConfirm = useCallback((options?: PasswordConfirmOptions): Promise<string | null> => {
    return new Promise((resolve) => {
      resolveRef.current = resolve;

      // Add a small delay to allow the previous dialog to dismiss before navigating
      setTimeout(() => {
        // Navigate to password-confirm screen with optional params
        router.push({
          pathname: '/(tabs)/settings/password-confirm',
          params: {
            ...(options?.description && { description: options.description }),
          },
        });
      }, NAVIGATION_DELAY_MS);
    });
  }, []);

  return {
    requestPasswordConfirm,
  };
}
