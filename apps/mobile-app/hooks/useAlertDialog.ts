import { useState, useCallback } from 'react';

import type { IConfirmDialogButton } from '@/components/common/ConfirmDialog';

interface AlertDialogConfig {
  title: string;
  message: string;
  buttons: IConfirmDialogButton[];
}

interface UseAlertDialogReturn {
  /** Whether the alert dialog is visible. */
  isVisible: boolean;
  /** Alert dialog configuration. */
  config: AlertDialogConfig | null;
  /**
   * Show an alert dialog with a single OK button.
   */
  showAlert: (title: string, message: string, onOk?: () => void) => void;
  /**
   * Show a confirm dialog with Cancel and action buttons.
   */
  showConfirm: (
    title: string,
    message: string,
    confirmText: string,
    onConfirm: () => void | Promise<void>,
    options?: {
      cancelText?: string;
      confirmStyle?: 'default' | 'destructive';
    }
  ) => void;
  /**
   * Show a custom dialog with any buttons.
   */
  showCustom: (title: string, message: string, buttons: IConfirmDialogButton[]) => void;
  /**
   * Hide the alert dialog.
   */
  hideAlert: () => void;
}

/**
 * Hook for managing alert dialog state.
 *
 * Usage:
 * ```tsx
 * const { isVisible, config, showAlert, showConfirm, hideAlert } = useAlertDialog();
 *
 * // Show simple alert
 * showAlert(t('common.error'), t('auth.errors.enterPassword'));
 *
 * // Show confirm dialog
 * showConfirm(
 *   t('items.deleteItem'),
 *   t('items.deleteConfirm'),
 *   t('common.delete'),
 *   handleDelete,
 *   { confirmStyle: 'destructive' }
 * );
 *
 * // Render the dialog
 * <ConfirmDialog
 *   isVisible={isVisible}
 *   title={config?.title ?? ''}
 *   message={config?.message ?? ''}
 *   buttons={config?.buttons ?? []}
 *   onClose={hideAlert}
 * />
 * ```
 */
export function useAlertDialog(): UseAlertDialogReturn {
  const [config, setConfig] = useState<AlertDialogConfig | null>(null);

  const hideAlert = useCallback((): void => {
    setConfig(null);
  }, []);

  const showAlert = useCallback((title: string, message: string, onOk?: () => void): void => {
    setConfig({
      title,
      message,
      buttons: [{
        text: 'OK',
        style: 'default',
        onPress: (): void => {
          onOk?.();
          setConfig(null);
        },
      }],
    });
  }, []);

  const showConfirm = useCallback((
    title: string,
    message: string,
    confirmText: string,
    onConfirm: () => void | Promise<void>,
    options?: {
      cancelText?: string;
      confirmStyle?: 'default' | 'destructive';
    }
  ): void => {
    setConfig({
      title,
      message,
      buttons: [
        {
          text: options?.cancelText ?? 'Cancel',
          style: 'cancel',
          onPress: (): void => setConfig(null),
        },
        {
          text: confirmText,
          style: options?.confirmStyle ?? 'default',
          onPress: async (): Promise<void> => {
            await onConfirm();
            setConfig(null);
          },
        },
      ],
    });
  }, []);

  const showCustom = useCallback((title: string, message: string, buttons: IConfirmDialogButton[]): void => {
    setConfig({ title, message, buttons });
  }, []);

  return {
    isVisible: config !== null,
    config,
    showAlert,
    showConfirm,
    showCustom,
    hideAlert,
  };
}

export default useAlertDialog;
