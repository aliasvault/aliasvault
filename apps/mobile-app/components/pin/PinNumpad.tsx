import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, View, Text, Pressable, Animated } from 'react-native';

import { useColors } from '@/hooks/useColorScheme';
import { ThemedText } from '@/components/themed/ThemedText';
import { RobustPressable } from '@/components/ui/RobustPressable';

/**
 * Animated button for numpad
 */
const AnimatedNumpadButton: React.FC<{
  value: string;
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
  style?: object;
}> = ({ value, onPress, colors, style }) => {
  const scaleAnim = React.useRef(new Animated.Value(1)).current;
  const opacityAnim = React.useRef(new Animated.Value(0)).current;

  const handlePressIn = () => {
    Animated.parallel([
      Animated.spring(scaleAnim, {
        toValue: 0.9,
        useNativeDriver: true,
        speed: 50,
        bounciness: 0,
      }),
      Animated.timing(opacityAnim, {
        toValue: 1,
        duration: 100,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const handlePressOut = () => {
    Animated.parallel([
      Animated.spring(scaleAnim, {
        toValue: 1,
        useNativeDriver: true,
        speed: 50,
        bounciness: 10,
      }),
      Animated.timing(opacityAnim, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const buttonStyles = StyleSheet.create({
    button: {
      alignItems: 'center',
      backgroundColor: colors.accentBackground,
      borderRadius: 12,
      height: 60,
      justifyContent: 'center',
      overflow: 'hidden',
    },
    overlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: colors.primary,
      borderRadius: 12,
    },
    text: {
      color: colors.text,
      fontSize: 24,
      fontWeight: '600',
    },
  });

  return (
    <Pressable
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={style}
    >
      <Animated.View
        style={[
          buttonStyles.button,
          {
            transform: [{ scale: scaleAnim }],
          },
        ]}
      >
        {/* Highlight overlay */}
        <Animated.View
          style={[
            buttonStyles.overlay,
            {
              opacity: opacityAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [0, 0.2],
              }),
            },
          ]}
        />

        {/* Button content */}
        {typeof value === 'string' && value.length === 1 ? (
          <Text style={buttonStyles.text}>{value}</Text>
        ) : (
          <MaterialIcons name="backspace" size={24} color={colors.text} />
        )}
      </Animated.View>
    </Pressable>
  );
};

interface PinNumpadProps {
  pin: string;
  pinLength?: number; // Optional: if provided, shows dots; if not, shows digits
  onPinChange: (pin: string) => void;
  onSubmit?: () => void; // Optional: if provided, shows confirm button
  error?: string | null;
  title?: string;
  subtitle?: string;
  submitButtonText?: string;
  minLength?: number; // Minimum PIN length (default: 4)
  maxLength?: number; // Maximum PIN length (default: unlimited)
}

/**
 * Reusable PIN numpad component with dots or digit display
 */
export const PinNumpad: React.FC<PinNumpadProps> = ({
  pin,
  pinLength,
  onPinChange,
  onSubmit,
  error,
  title,
  subtitle,
  submitButtonText = 'Confirm',
  minLength = 4,
  maxLength,
}) => {
  const colors = useColors();
  const showDots = pinLength !== undefined;
  const showSubmitButton = onSubmit !== undefined;

  const handleNumpadClick = (digit: string) => {
    if (maxLength === undefined || pin.length < maxLength) {
      onPinChange(pin + digit);
    }
  };

  const handleBackspace = () => {
    onPinChange(pin.slice(0, -1));
  };

  const canSubmit = pin.length >= minLength;

  const styles = StyleSheet.create({
    confirmButton: {
      alignItems: 'center',
      backgroundColor: canSubmit ? colors.primary : colors.accentBorder,
      borderRadius: 8,
      height: 50,
      justifyContent: 'center',
      marginTop: 16,
      opacity: canSubmit ? 1 : 0.5,
    },
    confirmButtonText: {
      color: colors.primarySurfaceText,
      fontSize: 16,
      fontWeight: '600',
    },
    container: {
      width: '100%',
    },
    digitDisplay: {
      color: colors.text,
      fontSize: 42,
      fontWeight: '600',
      letterSpacing: 8,
      marginBottom: 24,
      minHeight: 48,
      textAlign: 'center',
    },
    errorText: {
      color: colors.errorText,
      fontSize: 14,
      marginBottom: 12,
      textAlign: 'center',
    },
    numpadButton: {
      alignItems: 'center',
      backgroundColor: colors.accentBackground,
      borderRadius: 12,
      height: 60,
      justifyContent: 'center',
    },
    numpadButtonText: {
      color: colors.text,
      fontSize: 24,
      fontWeight: '600',
    },
    numpadContainer: {
      marginTop: 16,
    },
    numpadRow: {
      flexDirection: 'row',
      gap: 12,
      marginBottom: 12,
    },
    pinDot: {
      borderColor: colors.accentBorder,
      borderRadius: 12,
      borderWidth: 2,
      height: 16,
      width: 16,
    },
    pinDotFilled: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    pinDotsContainer: {
      flexDirection: 'row',
      gap: 12,
      justifyContent: 'center',
      marginBottom: 24,
    },
    subtitle: {
      color: colors.text,
      fontSize: 16,
      marginBottom: 24,
      opacity: 0.7,
      textAlign: 'center',
    },
    title: {
      color: colors.text,
      fontSize: 20,
      fontWeight: '600',
      marginBottom: 8,
      textAlign: 'center',
    },
  });

  return (
    <View style={styles.container}>
      {/* Title */}
      {title && <ThemedText style={styles.title}>{title}</ThemedText>}

      {/* Subtitle */}
      {subtitle && <ThemedText style={styles.subtitle}>{subtitle}</ThemedText>}

      {/* PIN Display */}
      {showDots ? (
        // Show dots for fixed length
        <View style={styles.pinDotsContainer}>
          {Array.from({ length: pinLength }).map((_, i) => (
            <View
              key={i}
              style={[
                styles.pinDot,
                i < pin.length && styles.pinDotFilled
              ]}
            />
          ))}
        </View>
      ) : (
        // Show asterisks for variable length
        <Text style={styles.digitDisplay}>
          {pin ? '•'.repeat(pin.length) : '----'}
        </Text>
      )}

      {/* Error Message */}
      {error && <ThemedText style={styles.errorText}>{error}</ThemedText>}

      {/* On-Screen Numpad */}
      <View style={styles.numpadContainer}>
        {/* Row 1: 1-3 */}
        <View style={styles.numpadRow}>
          {[1, 2, 3].map((num) => (
            <AnimatedNumpadButton
              key={num}
              value={num.toString()}
              onPress={() => handleNumpadClick(num.toString())}
              colors={colors}
              style={{ flex: 1 }}
            />
          ))}
        </View>

        {/* Row 2: 4-6 */}
        <View style={styles.numpadRow}>
          {[4, 5, 6].map((num) => (
            <AnimatedNumpadButton
              key={num}
              value={num.toString()}
              onPress={() => handleNumpadClick(num.toString())}
              colors={colors}
              style={{ flex: 1 }}
            />
          ))}
        </View>

        {/* Row 3: 7-9 */}
        <View style={styles.numpadRow}>
          {[7, 8, 9].map((num) => (
            <AnimatedNumpadButton
              key={num}
              value={num.toString()}
              onPress={() => handleNumpadClick(num.toString())}
              colors={colors}
              style={{ flex: 1 }}
            />
          ))}
        </View>

        {/* Row 4: Empty, 0, Backspace */}
        <View style={styles.numpadRow}>
          <View style={{ flex: 1 }} />
          <AnimatedNumpadButton
            value="0"
            onPress={() => handleNumpadClick('0')}
            colors={colors}
            style={{ flex: 1 }}
          />
          <AnimatedNumpadButton
            value="backspace"
            onPress={handleBackspace}
            colors={colors}
            style={{ flex: 1 }}
          />
        </View>
      </View>

      {/* Confirm Button - only show if onSubmit is provided */}
      {showSubmitButton && (
        <RobustPressable
          style={styles.confirmButton}
          onPress={onSubmit}
          disabled={!canSubmit}
        >
          <ThemedText style={styles.confirmButtonText}>
            {submitButtonText}
          </ThemedText>
        </RobustPressable>
      )}
    </View>
  );
};
