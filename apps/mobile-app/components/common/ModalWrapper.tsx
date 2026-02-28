import React from 'react';
import {
  Modal,
  StyleSheet,
  Text,
  View,
  KeyboardAvoidingView,
  Platform,
  TouchableWithoutFeedback,
  Keyboard,
  ScrollView,
  StatusBar,
} from 'react-native';

import { useColors } from '@/hooks/useColorScheme';

interface IModalWrapperProps {
  /** Whether the modal is visible. */
  isOpen: boolean;
  /** Callback when the modal is requested to close. */
  onClose: () => void;
  /** Whether closing is disabled (e.g., during submission). */
  isSubmitting?: boolean;
  /** Optional modal title. */
  title?: string;
  /** Modal body content. */
  children: React.ReactNode;
  /** Optional footer content (e.g., buttons). */
  footer?: React.ReactNode;
  /** Whether to enable keyboard avoiding behavior. Default: false. */
  keyboardAvoiding?: boolean;
  /** Whether the content should be scrollable. Default: false. */
  scrollable?: boolean;
  /** Maximum height for scrollable content. Default: 400. */
  maxScrollHeight?: number;
  /** Animation type for the modal. Default: 'fade'. */
  animationType?: 'fade' | 'slide' | 'none';
  /** Custom max width for the container. Default: 400. */
  maxWidth?: number;
  /** Custom width percentage. Default: '90%'. */
  width?: string;
  /** Whether to show header border. Default: true (only when title is provided). */
  showHeaderBorder?: boolean;
  /** Whether to show footer border. Default: true (only when footer is provided). */
  showFooterBorder?: boolean;
}

/**
 * A generic modal wrapper component that provides consistent behavior:
 * - Themed backdrop (dark/light mode support)
 * - Consistent container styling
 * - Optional title with header
 * - Optional scrollable content
 * - Optional keyboard avoiding behavior
 * - Prevents closing during submission
 */
export const ModalWrapper: React.FC<IModalWrapperProps> = ({
  isOpen,
  onClose,
  isSubmitting = false,
  title,
  children,
  footer,
  keyboardAvoiding = false,
  scrollable = false,
  maxScrollHeight = 400,
  animationType = 'fade',
  maxWidth = 400,
  width = '90%',
  showHeaderBorder = true,
  showFooterBorder = true,
}) => {
  const colors = useColors();

  /**
   * Handle close - only allow if not submitting.
   */
  const handleClose = (): void => {
    if (!isSubmitting) {
      onClose();
    }
  };

  const styles = StyleSheet.create({
    backdrop: {
      alignItems: 'center',
      // Lighter backdrop in dark mode for better contrast against black background
      backgroundColor: 'rgba(0, 0, 0, 0.65)',
      flex: 1,
      justifyContent: 'center',
    },
    container: {
      backgroundColor: colors.background,
      borderColor: colors.accentBorder,
      borderRadius: 12,
      borderWidth: 1,
      elevation: 10,
      marginHorizontal: 16,
      maxWidth,
      overflow: 'hidden',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 8,
      width: width as never,
    },
    header: {
      borderBottomColor: showHeaderBorder ? colors.accentBorder : 'transparent',
      borderBottomWidth: showHeaderBorder ? 1 : 0,
      padding: 20,
      paddingBottom: 16,
    },
    title: {
      color: colors.text,
      fontSize: 18,
      fontWeight: '600',
    },
    body: {
      padding: 20,
    },
    scrollBody: {
      maxHeight: maxScrollHeight,
      padding: 20,
    },
    footer: {
      borderTopColor: showFooterBorder ? colors.accentBorder : 'transparent',
      borderTopWidth: showFooterBorder ? 1 : 0,
      padding: 16,
    },
  });

  const renderContent = (): React.ReactNode => (
    <View style={styles.container}>
      {title && (
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
        </View>
      )}

      {scrollable ? (
        <ScrollView style={styles.scrollBody}>
          {children}
        </ScrollView>
      ) : (
        <View style={styles.body}>
          {children}
        </View>
      )}

      {footer && (
        <View style={styles.footer}>
          {footer}
        </View>
      )}
    </View>
  );

  const renderBackdrop = (): React.ReactNode => {
    if (keyboardAvoiding) {
      return (
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.backdrop}
          >
            <TouchableWithoutFeedback>
              {renderContent()}
            </TouchableWithoutFeedback>
          </KeyboardAvoidingView>
        </TouchableWithoutFeedback>
      );
    }

    return (
      <View style={styles.backdrop}>
        {renderContent()}
      </View>
    );
  };

  return (
    <Modal
      visible={isOpen}
      transparent
      animationType={animationType}
      onRequestClose={handleClose}
      statusBarTranslucent
    >
      {isOpen && Platform.OS === 'android' && (
        <StatusBar
          backgroundColor="transparent"
          translucent
          barStyle="light-content"
        />
      )}
      {renderBackdrop()}
    </Modal>
  );
};

export default ModalWrapper;
