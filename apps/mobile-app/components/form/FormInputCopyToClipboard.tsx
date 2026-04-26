import { MaterialIcons } from '@expo/vector-icons';
import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { View, Text, Platform, TouchableOpacity, StyleSheet, Animated, Easing } from 'react-native';
import Toast from 'react-native-toast-message';

import { copyToClipboardWithExpiration } from '@/utils/ClipboardUtility';

import { useColors } from '@/hooks/useColorScheme';

import { useClipboardCountdown } from '@/context/ClipboardCountdownContext';
import { LocalPreferencesService } from '@/services/LocalPreferencesService';

type FormInputCopyToClipboardProps = {
  label: string;
  value: string | undefined;
  type?: 'text' | 'password';
  /** Optional element to render next to the label (e.g., history button) */
  labelSuffix?: React.ReactNode;
}

/**
 * Form input copy to clipboard component.
 */
const FormInputCopyToClipboard: React.FC<FormInputCopyToClipboardProps> = ({
  label,
  value,
  type = 'text',
  labelSuffix,
}) : React.ReactNode => {
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const colors = useColors();
  const { t } = useTranslation();
  const { activeField, startCountdown, clearCountdown } = useClipboardCountdown();

  const animatedWidth = useRef(new Animated.Value(0)).current;
  // Create a stable unique ID based on label and value
  const fieldId = useRef(`${label}-${value}-${Math.random().toString(36).substring(2, 11)}`).current;
  const isCountingDown = activeField?.fieldId === fieldId;
  // Re-trigger animation each time this field is (re)copied.
  const trigger = isCountingDown ? activeField.trigger : 0;
  const timeoutSeconds = isCountingDown ? activeField.timeoutSeconds : 0;

  useEffect(() => {
    if (!isCountingDown || timeoutSeconds <= 0) {
      animatedWidth.setValue(0);
      return;
    }

    animatedWidth.setValue(100);

    const animation = Animated.timing(animatedWidth, {
      toValue: 0,
      duration: timeoutSeconds * 1000,
      useNativeDriver: false,
      easing: Easing.linear,
    });

    animation.start(({ finished }) => {
      if (finished) {
        clearCountdown();
      }
    });

    return () => {
      animation.stop();
    };
  }, [isCountingDown, timeoutSeconds, trigger, animatedWidth, clearCountdown]);

  /**
   * Copy the value to the clipboard.
   */
  const copyToClipboard = async () : Promise<void> => {
    if (value) {
      try {
        // Get clipboard clear timeout from settings
        const timeoutSeconds = await LocalPreferencesService.getClipboardClearTimeout();

        // Use centralized clipboard utility
        await copyToClipboardWithExpiration(value, timeoutSeconds);

        // Handle animation state
        if (timeoutSeconds > 0) {
          startCountdown(fieldId, timeoutSeconds);
        }

        if (Platform.OS !== 'android') {
          // Only show toast on iOS, Android already shows a native toast on clipboard interactions.
          Toast.show({
            type: 'success',
            text1: t('common.copied'),
            position: 'bottom',
            visibilityTime: 2000,
          });
        }
      } catch (error) {
        console.error('Failed to copy to clipboard:', error);
        Toast.show({
          type: 'error',
          text1: t('common.error'),
          position: 'bottom',
          visibilityTime: 2000,
        });
      }
    }
  };

  const displayValue = type === 'password' && !isPasswordVisible
    ? '•'.repeat(value?.length || 0)
    : value;

  const styles = StyleSheet.create({
    actions: {
      alignItems: 'center',
      flexDirection: 'row',
    },
    animatedOverlay: {
      backgroundColor: `${colors.primary}50`,
      borderRadius: 8,
      bottom: 0,
      left: 0,
      position: 'absolute',
      top: 0,
    },
    iconButton: {
      padding: 8,
    },
    inputContainer: {
      backgroundColor: colors.accentBackground,
      borderRadius: 8,
      marginBottom: 8,
      overflow: 'hidden',
      position: 'relative',
    },
    inputContent: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      padding: 12,
    },
    label: {
      color: colors.textMuted,
      fontSize: 12,
      marginBottom: 4,
    },
    labelRow: {
      alignItems: 'center',
      flexDirection: 'row',
    },
    value: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '500',
    },
    valueContainer: {
      flex: 1,
    },
  });

  return (
    <TouchableOpacity
      onPress={copyToClipboard}
      style={styles.inputContainer}
    >
      {isCountingDown && (
        <Animated.View
          style={[
            styles.animatedOverlay,
            {
              width: animatedWidth.interpolate({
                inputRange: [0, 100],
                outputRange: ['0%', '100%'],
              }),
            },
          ]}
        />
      )}
      <View style={styles.inputContent}>
        <View style={styles.valueContainer}>
          {label && (
            <View style={styles.labelRow}>
              <Text style={styles.label}>
                {label}
              </Text>
              {labelSuffix}
            </View>
          )}
          <Text style={styles.value} numberOfLines={1} ellipsizeMode="tail">
            {displayValue}
          </Text>
        </View>
        <View style={styles.actions}>
          {type === 'password' && (
            <TouchableOpacity
              onPress={() => setIsPasswordVisible(!isPasswordVisible)}
              style={styles.iconButton}
            >
              <MaterialIcons
                name={isPasswordVisible ? "visibility-off" : "visibility"}
                size={20}
                color={colors.primary}
              />
            </TouchableOpacity>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
};

export default FormInputCopyToClipboard;