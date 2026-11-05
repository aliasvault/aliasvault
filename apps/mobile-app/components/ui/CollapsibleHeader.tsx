import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { BlurView } from 'expo-blur';
import { Stack } from 'expo-router';
import React from 'react';
import { StyleSheet, Platform, Animated, TouchableOpacity, useColorScheme, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useColors } from '@/hooks/useColorScheme';

import { ThemedText } from '@/components/themed/ThemedText';

const AnimatedBlurView = Animated.createAnimatedComponent(BlurView);

type HeaderButton = {
  icon: keyof typeof MaterialIcons.glyphMap;
  onPress: () => void;
  position: 'left' | 'right';
}

type CollapsibleHeaderProps = {
  title: string;
  scrollY: Animated.Value;
  showNavigationHeader?: boolean;
  alwaysVisible?: boolean;
  headerButtons?: HeaderButton[];
}

/**
 * Collapsible header component.
 * For iOS: Shows a collapsible header with blur effect
 * For Android: Returns null and uses native header instead
 */
export function CollapsibleHeader({
  title,
  scrollY,
  showNavigationHeader = false,
  alwaysVisible = false,
  headerButtons = []
}: CollapsibleHeaderProps): React.ReactNode {
  const colors = useColors();
  const colorScheme = useColorScheme();
  const insets = useSafeAreaInsets();

  // For Android, let the native header handle it. We do add a padding to the top of the screen to account for the status bar.
  if (Platform.OS === 'android') {
    return null;
  }

  // Calculate header opacity and transforms based on scroll
  const headerOpacity = scrollY.interpolate({
    inputRange: [10, 60],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  const titleOpacity = scrollY.interpolate({
    inputRange: [10, 60],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  const headerTransform = alwaysVisible
    ? new Animated.Value(0)
    : headerOpacity.interpolate({
      inputRange: [0, 1],
      outputRange: [-20, 0],
    });

  const styles = StyleSheet.create({
    floatingHeader: {
      alignItems: 'flex-end',
      flexDirection: 'row',
      height: insets.top + 44,
      justifyContent: 'center',
      left: 0,
      overflow: 'hidden',
      position: 'absolute',
      right: 0,
      top: 0,
      zIndex: 100,
    },
    floatingTitle: {
      color: colors.text,
      fontSize: 20,
      fontWeight: '600',
      marginTop: insets.top,
      textAlign: 'center',
    },
    floatingTitleContainer: {
      flex: 1,
      height: insets.top + 44,
      justifyContent: 'center',
    },
    headerBorder: {
      backgroundColor: colors.headerBorder,
      bottom: 0,
      height: 1,
      left: 0,
      position: 'absolute',
      right: 0,
    },
    headerButton: {
      bottom: 2,
      padding: 4,
      position: 'absolute',
    },
    leftButton: {
      left: 16,
    },
    rightButton: {
      right: 16,
    },
  });

  return (
    <>
      {showNavigationHeader && (
        <Stack.Screen options={{ title, headerShown: false }} />
      )}

      <Animated.View
        style={[
          styles.floatingHeader,
          {
            transform: [{ translateY: headerTransform }],
          },
        ]}
      >
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: headerOpacity }]}>
          <AnimatedBlurView
            tint={colorScheme === 'dark' ? 'dark' : 'light'}
            intensity={colorScheme === 'dark' ? 80 : 100}
            style={[StyleSheet.absoluteFill, { backgroundColor: colors.headerBackgroundIos }]}
          />
          <View style={styles.headerBorder} />
        </Animated.View>

        <Animated.View
          style={[
            styles.floatingTitleContainer,
            { opacity: alwaysVisible ? titleOpacity : headerOpacity },
          ]}
        >
          <ThemedText style={styles.floatingTitle}>{title}</ThemedText>
        </Animated.View>

        {headerButtons.map((button, idx) => (
          <TouchableOpacity
            key={`${button.icon}-${idx}`}
            style={[
              styles.headerButton,
              button.position === 'left' ? styles.leftButton : styles.rightButton,
            ]}
            onPress={button.onPress}
          >
            <MaterialIcons name={button.icon} size={28} color={colors.primary} />
          </TouchableOpacity>
        ))}

        <Animated.View
          style={{ opacity: headerOpacity }}
        />
      </Animated.View>
    </>
  );
}
