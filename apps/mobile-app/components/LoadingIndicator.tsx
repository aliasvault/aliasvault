import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, Text, Animated, useColorScheme, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useColors } from '@/hooks/useColorScheme';

type LoadingIndicatorProps = {
  status: string;
  showOfflineButton?: boolean;
  onOfflinePress?: () => void;
};

/**
 * Loading indicator component.
 */
export default function LoadingIndicator({ status, showOfflineButton, onOfflinePress }: LoadingIndicatorProps): React.ReactNode {
  const colors = useColors();
  const dot1Anim = useRef(new Animated.Value(0)).current;
  const dot2Anim = useRef(new Animated.Value(0)).current;
  const dot3Anim = useRef(new Animated.Value(0)).current;
  const dot4Anim = useRef(new Animated.Value(0)).current;
  const animationRef = useRef<Animated.CompositeAnimation | null>(null);
  const [dots, setDots] = useState('');
  const colorScheme = useColorScheme();

  useEffect(() => {
    /**
     * Create the pulse animation.
     */
    const createPulseAnimation = (anim: Animated.Value): Animated.CompositeAnimation => {
      return Animated.sequence([
        Animated.timing(anim, {
          toValue: 1,
          duration: 700,
          useNativeDriver: true,
        }),
        Animated.timing(anim, {
          toValue: 0,
          duration: 700,
          useNativeDriver: true,
        }),
      ]);
    };

    // Stop any previous animation
    if (animationRef.current) {
      animationRef.current.stop();
    }

    const newAnimation = Animated.loop(
      Animated.parallel([
        createPulseAnimation(dot1Anim),
        Animated.sequence([
          Animated.delay(200),
          createPulseAnimation(dot2Anim),
        ]),
        Animated.sequence([
          Animated.delay(400),
          createPulseAnimation(dot3Anim),
        ]),
        Animated.sequence([
          Animated.delay(600),
          createPulseAnimation(dot4Anim),
        ]),
      ])
    );

    animationRef.current = newAnimation;
    newAnimation.start();

    // Reset dots when status changes
    setDots('');

    const dotsInterval = setInterval(() => {
      setDots(prevDots => {
        if (prevDots.length >= 3) {
          return '';
        }
        return prevDots + '.';
      });
    }, 400);

    return (): void => {
      if (animationRef.current) {
        animationRef.current.stop();
      }
      clearInterval(dotsInterval);
    };
  }, [status, dot1Anim, dot2Anim, dot3Anim, dot4Anim]);

  /*
   * If the status ends with a pipe character (|), don't show any dots
   * This provides an explicit way to disable the loading dots animation
   */
  const statusTrimmed = status.endsWith('|') ? status.slice(0, -1) : status;
  const shouldShowDots = !status.endsWith('|');

  const backgroundColor = colorScheme === 'dark' ? 'transparent' : '#fff';
  const shadowColor = '#000';

  const styles = StyleSheet.create({
    container: {
      alignItems: 'center',
      justifyContent: 'center',
      padding: 20,
      ...StyleSheet.absoluteFillObject,
    },
    closeIconContainer: {
      position: 'absolute',
      right: 20,
      top: 60,
      zIndex: 10,
    },
    closeIcon: {
      padding: 12,
      borderRadius: 32,
      backgroundColor: colors.accentBackground,
      borderWidth: 2,
      borderColor: colors.accentBorder,
    },
    contentContainer: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    dot: {
      backgroundColor: colors.tertiary,
      borderRadius: 4,
      height: 8,
      width: 8,
    },
    dotsContainer: {
      backgroundColor: backgroundColor,
      borderColor: colors.tertiary,
      borderRadius: 20,
      borderWidth: 5,
      elevation: 1,
      flexDirection: 'row',
      gap: 10,
      padding: 12,
      paddingHorizontal: 24,
      shadowColor: shadowColor,
      shadowOffset: {
        width: 0,
        height: 1,
      },
      shadowOpacity: 0.05,
      shadowRadius: 2,
    },
    statusText: {
      color: colors.text,
      fontSize: 16,
      marginTop: 16,
      textAlign: 'center',
    },
  });

  return (
    <View style={styles.container}>
      {showOfflineButton && (
        <View style={styles.closeIconContainer}>
          <TouchableOpacity style={styles.closeIcon} onPress={onOfflinePress}>
            <Ionicons name="close" size={24} color={colors.text} />
          </TouchableOpacity>
        </View>
      )}
      <View style={styles.contentContainer}>
        <View style={styles.dotsContainer}>
        <Animated.View
          style={[
            styles.dot,
            {
              opacity: dot1Anim.interpolate({
                inputRange: [0, 1],
                outputRange: [0.3, 1],
              }),
            },
          ]}
        />
        <Animated.View
          style={[
            styles.dot,
            {
              opacity: dot2Anim.interpolate({
                inputRange: [0, 1],
                outputRange: [0.3, 1],
              }),
            },
          ]}
        />
        <Animated.View
          style={[
            styles.dot,
            {
              opacity: dot3Anim.interpolate({
                inputRange: [0, 1],
                outputRange: [0.3, 1],
              }),
            },
          ]}
        />
        <Animated.View
          style={[
            styles.dot,
            {
              opacity: dot4Anim.interpolate({
                inputRange: [0, 1],
                outputRange: [0.3, 1],
              }),
            },
          ]}
        />
      </View>
        <Text style={styles.statusText}>
          {statusTrimmed}
          {shouldShowDots && dots}
        </Text>
      </View>
    </View>
  );
}
