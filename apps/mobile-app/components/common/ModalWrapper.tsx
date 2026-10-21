import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Modal,
  StyleSheet,
  Text,
  View,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Keyboard,
  ScrollView,
  StatusBar,
} from 'react-native';

import { useColors } from '@/hooks/useColorScheme';

import { ModalBackdrop } from '@/components/common/ModalBackdrop';

interface IModalWrapperProps {
  isOpen: boolean;
  onClose: () => void;
  isSubmitting?: boolean;
  title?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  keyboardAvoiding?: boolean;
  scrollable?: boolean;
  maxScrollHeight?: number;
  animationType?: 'fade' | 'slide' | 'none';
  maxWidth?: number;
  width?: string;
  showHeaderBorder?: boolean;
  showFooterBorder?: boolean;
  closeOnBackdropPress?: boolean;
  /** Show a close (X) button next to the title. */
  showCloseButton?: boolean;
}

/**
 * A generic modal wrapper component that provides consistent behavior:
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
  closeOnBackdropPress = false,
  showCloseButton = false,
}) => {
  const colors = useColors();
  const { t } = useTranslation();

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
      flex: 1,
      justifyContent: 'center',
    },
    container: {
      backgroundColor: colors.modalSurface,
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
    closeButton: {
      marginRight: -4,
      padding: 4,
    },
    closeButtonDisabled: {
      opacity: 0.4,
    },
    header: {
      alignItems: 'center',
      borderBottomColor: showHeaderBorder ? colors.accentBorder : 'transparent',
      borderBottomWidth: showHeaderBorder ? 1 : 0,
      flexDirection: 'row',
      gap: 12,
      padding: 20,
      paddingBottom: 16,
    },
    title: {
      color: colors.text,
      flex: 1,
      fontSize: 18,
      fontWeight: '600',
    },
    body: {
      padding: 20,
      paddingTop: 0,
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

  /**
   * The modal card: title, body and footer.
   */
  const renderContent = (): React.ReactNode => (
    <View style={styles.container}>
      {title && (
        <View style={styles.header}>
          <Text style={styles.title} numberOfLines={showCloseButton ? 2 : undefined}>{title}</Text>
          {showCloseButton && (
            <TouchableOpacity style={[styles.closeButton, isSubmitting && styles.closeButtonDisabled]} onPress={handleClose} disabled={isSubmitting} accessibilityRole="button" accessibilityLabel={t('common.close')} hitSlop={8}>
              <Ionicons name="close" size={22} color={colors.textMuted} />
            </TouchableOpacity>
          )}
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

  /**
   * The backdrop around the card, with keyboard avoiding or close on press when asked for.
   */
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

    if (closeOnBackdropPress) {
      return (
        <TouchableWithoutFeedback onPress={handleClose}>
          <View style={styles.backdrop}>
            <TouchableWithoutFeedback>
              {renderContent()}
            </TouchableWithoutFeedback>
          </View>
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
      <ModalBackdrop />
      {renderBackdrop()}
    </Modal>
  );
};

export default ModalWrapper;
