import React, { useState, useCallback, useEffect } from 'react';
import {
  Alert,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ActivityIndicator,
  ViewStyle,
  TextStyle,
} from 'react-native';

import { useColors } from '@/hooks/useColorScheme';
import { ModalWrapper } from '@/components/common/ModalWrapper';

/**
 * Button configuration for confirm dialog.
 */
export interface IConfirmDialogButton {
  /** Button label text. */
  text: string;
  /** Button style - determines appearance. */
  style?: 'default' | 'cancel' | 'destructive';
  /** Callback when button is pressed. Can be async. */
  onPress?: () => void | Promise<void>;
}

interface IConfirmDialogProps {
  /** Whether the dialog is visible. */
  isVisible: boolean;
  /** Dialog title. */
  title: string;
  /** Dialog message/description. */
  message: string;
  /** Array of buttons to display. */
  buttons: IConfirmDialogButton[];
  /** Callback when dialog is closed (via backdrop tap or cancel). */
  onClose: () => void;
}

/**
 * Cross-platform confirm dialog component.
 *
 * On iOS: Uses native Alert.alert() for platform-consistent UX.
 * On Android: Uses custom ModalWrapper for better styling.
 *
 * Usage:
 * ```tsx
 * <ConfirmDialog
 *   isVisible={showConfirm}
 *   title="Delete Item"
 *   message="Are you sure you want to delete this item?"
 *   buttons={[
 *     { text: 'Cancel', style: 'cancel', onPress: () => setShowConfirm(false) },
 *     { text: 'Delete', style: 'destructive', onPress: handleDelete },
 *   ]}
 *   onClose={() => setShowConfirm(false)}
 * />
 * ```
 */
export const ConfirmDialog: React.FC<IConfirmDialogProps> = ({
  isVisible,
  title,
  message,
  buttons,
  onClose,
}) => {
  const colors = useColors();
  const [loadingButtonIndex, setLoadingButtonIndex] = useState<number | null>(null);

  /**
   * Show iOS native alert when visible.
   * We track whether we've shown the alert for this visibility state to prevent
   * showing it multiple times.
   */
  const [hasShownAlert, setHasShownAlert] = useState(false);

  useEffect(() => {
    if (Platform.OS === 'ios' && isVisible && !hasShownAlert) {
      setHasShownAlert(true);

      const alertButtons = buttons.map((button) => ({
        text: button.text,
        style: button.style,
        onPress: () => {
          button.onPress?.();
          // Always call onClose after any button press to reset visibility state
          onClose();
        },
      }));

      Alert.alert(title, message, alertButtons);
    } else if (!isVisible && hasShownAlert) {
      // Reset the flag when dialog becomes invisible
      setHasShownAlert(false);
    }
  }, [isVisible, title, message, buttons, hasShownAlert, onClose]);

  /**
   * Handle button press with loading state for async actions.
   */
  const handleButtonPress = useCallback(async (button: IConfirmDialogButton, index: number): Promise<void> => {
    if (!button.onPress) {
      onClose();
      return;
    }

    const result = button.onPress();

    // If the onPress returns a Promise, show loading state
    if (result instanceof Promise) {
      setLoadingButtonIndex(index);
      try {
        await result;
      } catch (error) {
        console.error('ConfirmDialog button action error:', error);
      } finally {
        setLoadingButtonIndex(null);
      }
    }
  }, [onClose]);

  // On iOS, return null since we use native Alert
  if (Platform.OS === 'ios') {
    return null;
  }

  const isSubmitting = loadingButtonIndex !== null;

  /**
   * Get button style based on button configuration.
   */
  const getButtonStyle = (button: IConfirmDialogButton, index: number): ViewStyle[] => {
    const baseStyle: ViewStyle[] = [styles.button];

    if (button.style === 'destructive') {
      baseStyle.push({ backgroundColor: colors.destructive } as ViewStyle);
    } else if (button.style === 'cancel') {
      baseStyle.push({
        backgroundColor: colors.accentBackground,
        borderColor: colors.accentBorder,
        borderWidth: 1,
      } as ViewStyle);
    } else {
      baseStyle.push({ backgroundColor: colors.primary } as ViewStyle);
    }

    if (isSubmitting && loadingButtonIndex === index) {
      baseStyle.push(styles.buttonDisabled);
    }

    return baseStyle;
  };

  /**
   * Get button text style based on button configuration.
   */
  const getButtonTextStyle = (button: IConfirmDialogButton): TextStyle[] => {
    const baseStyle: TextStyle[] = [styles.buttonText];

    if (button.style === 'cancel') {
      baseStyle.push({ color: colors.text } as TextStyle);
    } else {
      baseStyle.push({ color: colors.white } as TextStyle);
    }

    return baseStyle;
  };

  const styles = StyleSheet.create({
    message: {
      color: colors.textMuted,
      fontSize: 14,
      lineHeight: 20,
    },
    buttonsContainer: {
      flexDirection: 'row',
      gap: 12,
      marginTop: 20,
    },
    button: {
      alignItems: 'center',
      borderRadius: 8,
      flex: 1,
      flexDirection: 'row',
      gap: 8,
      justifyContent: 'center',
      paddingVertical: 12,
    },
    buttonDisabled: {
      opacity: 0.6,
    },
    buttonText: {
      fontSize: 16,
      fontWeight: '500',
    },
  });

  return (
    <ModalWrapper
      isOpen={isVisible}
      onClose={onClose}
      isSubmitting={isSubmitting}
      title={title}
      showHeaderBorder={false}
      showFooterBorder={false}
    >
      <Text style={styles.message}>{message}</Text>

      <View style={styles.buttonsContainer}>
        {buttons.map((button, index) => (
          <TouchableOpacity
            key={index}
            style={getButtonStyle(button, index)}
            onPress={() => handleButtonPress(button, index)}
            disabled={isSubmitting}
          >
            {isSubmitting && loadingButtonIndex === index && (
              <ActivityIndicator
                size="small"
                color={button.style === 'cancel' ? colors.text : colors.white}
              />
            )}
            <Text style={getButtonTextStyle(button)}>{button.text}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </ModalWrapper>
  );
};

export default ConfirmDialog;
