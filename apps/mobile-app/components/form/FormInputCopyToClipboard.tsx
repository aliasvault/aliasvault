import { MaterialIcons } from '@expo/vector-icons';
import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { View, Text, TouchableOpacity, StyleSheet, Platform, Animated, Easing } from 'react-native';
import Toast from 'react-native-toast-message';

import { copyToClipboardWithExpiration } from '@/utils/ClipboardUtility';

import { useColors } from '@/hooks/useColorScheme';

import { useAuth } from '@/context/AuthContext';
import { useClipboardCountdown } from '@/context/ClipboardCountdownContext';

type FormInputCopyToClipboardProps = {
  label: string;
  value: string | undefined;
  type?: 'text' | 'password';
}

/**
 * Form input copy to clipboard component.
 */
const FormInputCopyToClipboard: React.FC<FormInputCopyToClipboardProps> = ({
  label,
  value,
  type = 'text',
}) : React.ReactNode => {
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const colors = useColors();
  const { t } = useTranslation();
  const { getClipboardClearTimeout } = useAuth();
  const { activeFieldId, setActiveField } = useClipboardCountdown();

  const animatedWidth = useRef(new Animated.Value(0)).current;
  // Create a stable unique ID based on label and value
  const fieldId = useRef(`${label}-${value}-${Math.random().toString(36).substring(2, 11)}`).current;
  const isCountingDown = activeFieldId === fieldId;

  useEffect(() => {
    return (): void => {
      // Cleanup on unmount
      animatedWidth.stopAnimation();
    };
  }, [animatedWidth]);

  useEffect(() => {
    let animationRef: Animated.CompositeAnimation | null = null;
    let isCancelled = false;

    /* Handle animation based on whether this field is active */
    if (isCountingDown) {
      // This field is now active - reset and start animation
      animatedWidth.stopAnimation();
      animatedWidth.setValue(100);

      // Get timeout and start animation
      getClipboardClearTimeout().then((timeoutSeconds) => {
        if (!isCancelled && timeoutSeconds > 0 && activeFieldId === fieldId) {
          animationRef = Animated.timing(animatedWidth, {
            toValue: 0,
            duration: timeoutSeconds * 1000,
            useNativeDriver: false,
            easing: Easing.linear,
          });
          
          animationRef.start((finished) => {
            if (!isCancelled && finished && activeFieldId === fieldId) {
              // Use requestAnimationFrame to defer state update
              requestAnimationFrame(() => {
                if (!isCancelled) {
                  setActiveField(null);
                }
              });
            }
          });
        }
      });
    } else {
      // This field is not active - stop animation and reset
      animatedWidth.stopAnimation();
      animatedWidth.setValue(0);
    }

    // Cleanup function
    return () => {
      isCancelled = true;
      if (animationRef) {
        animationRef.stop();
      }
      animatedWidth.stopAnimation();
    };
  }, [isCountingDown, activeFieldId, fieldId, animatedWidth, setActiveField, getClipboardClearTimeout]);

  /**
   * Copy the value to the clipboard.
   */
  const copyToClipboard = async () : Promise<void> => {
    if (value) {
      try {
        // Get clipboard clear timeout from settings
        const timeoutSeconds = await getClipboardClearTimeout();

        // Use centralized clipboard utility
        await copyToClipboardWithExpiration(value, timeoutSeconds);

        // Handle animation state
        if (timeoutSeconds > 0) {
          // Clear any existing active field and set this one as active
          // Use functional update to avoid closure issues
          setActiveField(() => {
            // If there was a previous field, its animation will be stopped by the effect
            return fieldId;
          });
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
    ? '••••••••'
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
          <Text style={styles.label}>
            {label}
          </Text>
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