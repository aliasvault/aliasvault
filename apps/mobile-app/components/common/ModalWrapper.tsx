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

import { ModalBackdrop } from '@/components/common/ModalBackdrop';
import { useColors } from '@/hooks/useColorScheme';

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
