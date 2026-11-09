import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { BlurView } from 'expo-blur';
import { Stack } from 'expo-router';
import React, { useMemo } from 'react';
import { StyleSheet, Platform, Animated, TouchableOpacity, useColorScheme, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useColors } from '@/hooks/useColorScheme';
import { useIsStackRoute } from '@/hooks/useTwoPane';

import { ThemedText } from '@/components/themed/ThemedText';

const AnimatedBlurView = Animated.createAnimatedComponent(BlurView);

/**
 * Height of the collapsible header bar below the status bar.
 */
const HEADER_BAR_HEIGHT = 44;

/**
 * Height of the collapsible header (status bar included) on iOS, 0 on Android where the native header is used.
 */
export function useCollapsibleHeaderHeight(): number {
  const insets = useSafeAreaInsets();
  if (Platform.OS !== 'ios') {
    return 0;
  }
  return insets.top + HEADER_BAR_HEIGHT;
}

/**
 * Scroll position of the list below a collapsible header, with what is needed to ignore the bounce past its end.
 */
export type CollapsibleHeaderScroll = {
  offsetY: Animated.Value;
  contentHeight: Animated.Value;
  layoutHeight: Animated.Value;
}

/**
 * Scroll state for a CollapsibleHeader plus the onScroll handler (native driver) to put on its list.
 */
export function useCollapsibleHeaderScroll(): { scroll: CollapsibleHeaderScroll; onScroll: (...args: unknown[]) => void } {
  return useMemo(() => {
    const scroll = { offsetY: new Animated.Value(0), contentHeight: new Animated.Value(0), layoutHeight: new Animated.Value(0) };
    const onScroll = Animated.event(
      [{ nativeEvent: { contentOffset: { y: scroll.offsetY }, contentSize: { height: scroll.contentHeight }, layoutMeasurement: { height: scroll.layoutHeight } } }],
      { useNativeDriver: true }
    );
    return { scroll, onScroll };
  }, []);
}

type HeaderButton = {
  icon: keyof typeof MaterialIcons.glyphMap;
  onPress: () => void;
  position: 'left' | 'right';
}

type CollapsibleHeaderProps = {
  title: string;
  scroll: CollapsibleHeaderScroll;
  showNavigationHeader?: boolean;
  alwaysVisible?: boolean;
  headerButtons?: HeaderButton[];
}

/**
 * Collapsible header component.
 * For iOS: Shows a collapsible header with blur effect that slides away on scroll down and returns on scroll up
 * For Android: Returns null and uses native header instead
 */
export function CollapsibleHeader({
  title,
  scroll,
  showNavigationHeader = false,
  alwaysVisible = false,
  headerButtons = []
}: CollapsibleHeaderProps): React.ReactNode {
  const colors = useColors();
  const colorScheme = useColorScheme();
  const insets = useSafeAreaInsets();
  const headerHeight = useCollapsibleHeaderHeight();
  const isStackRoute = useIsStackRoute();

  /*
   * Distance the bar is slid up, 0 (shown) to HEADER_BAR_HEIGHT (hidden): grows on scroll down, shrinks on scroll up.
   * Only the bar below the status bar slides away, so a notch or Dynamic Island keeps its strip; where the status bar
   * lives elsewhere (the iPhone Duo rail, insets.top 0) the whole header goes.
   */
  const scrollY = scroll.offsetY;
  const hideOffset = useMemo(() => {
    // Capped at the end of the content, so the bounce back from overscrolling the bottom does not count as scrolling up.
    const maxOffset = Animated.subtract(scroll.contentHeight, scroll.layoutHeight);
    const overscroll = Animated.subtract(scroll.offsetY, maxOffset).interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolateLeft: 'clamp' });
    const cappedY = Animated.subtract(scroll.offsetY, overscroll);
    const offset = cappedY.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolateLeft: 'clamp' });
    return Animated.diffClamp(offset, 0, HEADER_BAR_HEIGHT);
  }, [scroll]);

  // For Android, let the native header handle it.
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

  const fadeInTransform = alwaysVisible
    ? new Animated.Value(0)
    : headerOpacity.interpolate({
      inputRange: [0, 1],
      outputRange: [-20, 0],
    });

  const headerTransform = Animated.add(fadeInTransform, hideOffset.interpolate({
    inputRange: [0, HEADER_BAR_HEIGHT],
    outputRange: [0, -HEADER_BAR_HEIGHT],
  }));

  const barContentOpacity = hideOffset.interpolate({
    inputRange: [0, HEADER_BAR_HEIGHT],
    outputRange: [1, 0],
  });

  const styles = StyleSheet.create({
    floatingHeader: {
      alignItems: 'flex-end',
      flexDirection: 'row',
      height: headerHeight,
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
      height: headerHeight,
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
      {showNavigationHeader && isStackRoute && (
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
            { opacity: Animated.multiply(alwaysVisible ? titleOpacity : headerOpacity, barContentOpacity) },
          ]}
        >
          <ThemedText style={styles.floatingTitle} numberOfLines={1}>{title}</ThemedText>
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
