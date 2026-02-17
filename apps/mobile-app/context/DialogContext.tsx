import React, { createContext, useContext, useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { Alert, Platform } from 'react-native';

import { ConfirmDialog, type IConfirmDialogButton } from '@/components/common/ConfirmDialog';
import { dialogEventEmitter } from '@/events/DialogEventEmitter';
import i18n from '@/i18n';

interface DialogConfig {
  title: string;
  message: string;
  buttons: IConfirmDialogButton[];
}

interface DialogContextValue {
  /**
   * Show a simple alert with an OK button.
   */
  showAlert: (title: string, message: string, onOk?: () => void) => void;

  /**
   * Show a confirm dialog with Cancel and a custom action button.
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
  showDialog: (title: string, message: string, buttons: IConfirmDialogButton[]) => void;

  /**
   * Hide the current dialog.
   */
  hideDialog: () => void;
}

const DialogContext = createContext<DialogContextValue | null>(null);

/**
 * Hook to access the dialog service.
 *
 * Usage:
 * ```tsx
 * const { showAlert, showConfirm } = useDialog();
 *
 * // Simple alert
 * showAlert(t('common.error'), t('auth.errors.enterPassword'));
 *
 * // Confirm dialog
 * showConfirm(
 *   t('items.deleteItem'),
 *   t('items.deleteConfirm'),
 *   t('common.delete'),
 *   async () => { await deleteItem(); },
 *   { confirmStyle: 'destructive' }
 * );
 * ```
 */
export function useDialog(): DialogContextValue {
  const context = useContext(DialogContext);
  if (!context) {
    throw new Error('useDialog must be used within a DialogProvider');
  }
  return context;
}

interface DialogProviderProps {
  children: React.ReactNode;
}

/**
 * Provider component that enables the dialog service.
 * Add this near the root of your app (e.g., in _layout.tsx).
 */
export function DialogProvider({ children }: DialogProviderProps): React.ReactNode {
  const [dialogConfig, setDialogConfig] = useState<DialogConfig | null>(null);

  // Use a ref to store pending dialog config that survives re-renders/navigation
  const pendingDialogRef = useRef<DialogConfig | null>(null);

  // Check for pending dialogs on every render
  useEffect(() => {
    if (pendingDialogRef.current && !dialogConfig) {
      setDialogConfig(pendingDialogRef.current);
      pendingDialogRef.current = null;
    }
  });

  // Subscribe to dialog events from outside React (e.g., AuthContext logout)
  useEffect(() => {
    const unsubscribe = dialogEventEmitter.subscribe((title, message) => {
      // On iOS, use native Alert
      if (Platform.OS === 'ios') {
        Alert.alert(title, message, [{ text: 'OK', style: 'default' }]);
        return;
      }

      // On Android, use custom dialog with ref persistence
      const config: DialogConfig = {
        title,
        message,
        buttons: [{
          text: 'OK',
          style: 'default',
          onPress: (): void => {
            pendingDialogRef.current = null;
            setDialogConfig(null);
          },
        }],
      };

      pendingDialogRef.current = config;
      setDialogConfig(config);
    });

    return unsubscribe;
  }, []);

  /**
   * Hide the dialog.
   */
  const hideDialog = useCallback((): void => {
    pendingDialogRef.current = null;
    setDialogConfig(null);
  }, []);

  /**
   * Show a simple alert with an OK button.
   */
  const showAlert = useCallback((title: string, message: string, onOk?: () => void): void => {
    // On iOS, use native Alert
    if (Platform.OS === 'ios') {
      Alert.alert(title, message, [{
        text: i18n.t('common.ok'),
        style: 'default',
        onPress: onOk,
      }]);
      return;
    }

    // On Android, use custom dialog with ref persistence
    const config: DialogConfig = {
      title,
      message,
      buttons: [{
        text: i18n.t('common.ok'),
        style: 'default',
        onPress: (): void => {
          onOk?.();
          pendingDialogRef.current = null;
          setDialogConfig(null);
        },
      }],
    };

    // Store in ref so it persists through navigation/re-renders
    pendingDialogRef.current = config;
    setDialogConfig(config);
  }, []);

  /**
   * Show a confirm dialog with Cancel and action button.
   */
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
    // On iOS, use native Alert
    if (Platform.OS === 'ios') {
      Alert.alert(title, message, [
        { text: options?.cancelText ?? i18n.t('common.cancel'), style: 'cancel' },
        {
          text: confirmText,
          style: options?.confirmStyle ?? 'default',
          onPress: () => { onConfirm(); },
        },
      ]);
      return;
    }

    setDialogConfig({
      title,
      message,
      buttons: [
        {
          text: options?.cancelText ?? i18n.t('common.cancel'),
          style: 'cancel',
          onPress: (): void => setDialogConfig(null),
        },
        {
          text: confirmText,
          style: options?.confirmStyle ?? 'default',
          onPress: (): void => {
            setDialogConfig(null);
            onConfirm();
          },
        },
      ],
    });
  }, []);

  /**
   * Show a custom dialog with any buttons.
   */
  const showDialog = useCallback((title: string, message: string, buttons: IConfirmDialogButton[]): void => {
    // On iOS, use native Alert
    if (Platform.OS === 'ios') {
      const alertButtons = buttons.map(btn => ({
        text: btn.text,
        style: btn.style,
        onPress: () => { btn.onPress?.(); },
      }));
      Alert.alert(title, message, alertButtons);
      return;
    }

    // Wrap button onPress to auto-close dialog
    const wrappedButtons = buttons.map(btn => ({
      ...btn,
      onPress: async (): Promise<void> => {
        await btn.onPress?.();
        setDialogConfig(null);
      },
    }));

    setDialogConfig({ title, message, buttons: wrappedButtons });
  }, []);

  const contextValue = useMemo(() => ({
    showAlert,
    showConfirm,
    showDialog,
    hideDialog,
  }), [showAlert, showConfirm, showDialog, hideDialog]);

  return (
    <DialogContext.Provider value={contextValue}>
      {children}
      {/* Only render on Android since iOS uses native Alert */}
      {Platform.OS !== 'ios' && (
        <ConfirmDialog
          isVisible={dialogConfig !== null}
          title={dialogConfig?.title ?? ''}
          message={dialogConfig?.message ?? ''}
          buttons={dialogConfig?.buttons ?? []}
          onClose={hideDialog}
        />
      )}
    </DialogContext.Provider>
  );
}

export default DialogProvider;
