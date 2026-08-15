import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { BlurView } from 'expo-blur';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, BackHandler, Easing, Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { ItemType } from '@/utils/dist/core/models/vault';
import { HapticsUtility } from '@/utils/HapticsUtility';

import { useColorScheme, useColors } from '@/hooks/useColorScheme';

import { ITEM_TYPE_OPTIONS } from '@/components/items/ItemTypeSelector';
import { ThemedText } from '@/components/themed/ThemedText';
import { RobustPressable } from '@/components/ui/RobustPressable';

const FAB_SIZE = 56;
const MENU_GAP = 12;

type AddItemFabProps = {
  onSelectType: (type: ItemType) => void;
  testID?: string;
};

/**
 * Floating action button that pops out the list of item types that can be created.
 */
export const AddItemFab: React.FC<AddItemFabProps> = ({ onSelectType, testID }) => {
  const { t } = useTranslation();
  const colors = useColors();
  const colorScheme = useColorScheme();
  const insets = useSafeAreaInsets();

  const { width: windowWidth, height: windowHeight } = useWindowDimensions();

  const [isMounted, setIsMounted] = useState(false);
  const [backdropOffset, setBackdropOffset] = useState<{ left: number; top: number } | null>(null);
  const rootRef = useRef<View>(null);
  const isOpenRef = useRef(false);
  const progress = useRef(new Animated.Value(0)).current;
  const rowProgress = useRef(ITEM_TYPE_OPTIONS.map(() => new Animated.Value(0))).current;

  /**
   * Measure where this component sits in the window so the backdrop can cover the
   * full screen, including the padding of the screen container it is rendered in.
   */
  const measureBackdrop = useCallback((): void => {
    rootRef.current?.measureInWindow((x, y) => {
      setBackdropOffset({ left: -x, top: -y });
    });
  }, []);

  /**
   * Open the menu, unfurling the rows outwards from the button.
   */
  const open = useCallback((): void => {
    isOpenRef.current = true;
    setIsMounted(true);
    HapticsUtility.impact();

    Animated.parallel([
      Animated.timing(progress, {
        toValue: 1,
        duration: 180,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      // Android pills unfurl one by one; the rows nearest the button lead so the
      // menu appears to grow out of it. iOS animates the card as a whole instead.
      ...(Platform.OS === 'android' ? [
        Animated.stagger(35, [...rowProgress].reverse().map(value => Animated.spring(value, {
          toValue: 1,
          damping: 14,
          stiffness: 220,
          mass: 0.6,
          useNativeDriver: true,
        }))),
      ] : []),
    ]).start();
  }, [progress, rowProgress]);

  /**
   * Close the menu and unmount it once the exit animation has finished.
   */
  const close = useCallback((): void => {
    isOpenRef.current = false;

    Animated.parallel([
      Animated.timing(progress, {
        toValue: 0,
        duration: 130,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
      ...rowProgress.map(value => Animated.timing(value, {
        toValue: 0,
        duration: 110,
        useNativeDriver: true,
      })),
    ]).start(() => {
      if (!isOpenRef.current) {
        setIsMounted(false);
      }
    });
  }, [progress, rowProgress]);

  /**
   * Let the Android back button dismiss the menu instead of leaving the screen.
   */
  useEffect(() => {
    if (Platform.OS !== 'android' || !isMounted) {
      return;
    }

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!isOpenRef.current) {
        return false;
      }
      close();
      return true;
    });

    return () => subscription.remove();
  }, [isMounted, close]);

  /**
   * Close the menu and report the picked type to the parent screen.
   */
  const handleSelect = useCallback((type: ItemType): void => {
    close();
    onSelectType(type);
  }, [close, onSelectType]);

  /**
   * Toggle the menu open or closed.
   */
  const handleFabPress = useCallback((): void => {
    if (isOpenRef.current) {
      close();
    } else {
      open();
    }
  }, [close, open]);

  const fabBottom = Platform.OS === 'ios' ? insets.bottom + 60 : 16;

  const styles = StyleSheet.create({
    root: {
      zIndex: 1000,
    },
    backdropBox: {
      height: windowHeight,
      left: backdropOffset?.left ?? 0,
      position: 'absolute',
      top: backdropOffset?.top ?? 0,
      width: windowWidth,
    },
    scrim: {
      backgroundColor: Platform.OS === 'ios' ? 'transparent' : 'rgba(0, 0, 0, 0.3)',
    },
    fab: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: FAB_SIZE / 2,
      bottom: fabBottom,
      elevation: 4,
      height: FAB_SIZE,
      justifyContent: 'center',
      position: 'absolute',
      right: 16,
      shadowColor: colors.black,
      shadowOffset: {
        width: 0,
        height: 2,
      },
      shadowOpacity: 0.25,
      shadowRadius: 3.84,
      width: FAB_SIZE,
      zIndex: 1000,
    },
    fabIcon: {
      color: colors.primarySurfaceText,
      fontSize: 24,
    },
    menu: {
      alignItems: 'flex-end',
      bottom: fabBottom + FAB_SIZE + MENU_GAP,
      position: 'absolute',
      right: 16,
      zIndex: 1000,
    },
    /* Android: separate pills stacked above the button. */
    pill: {
      alignItems: 'center',
      backgroundColor: colors.accentBackground,
      borderColor: colors.accentBorder,
      borderRadius: 24,
      borderWidth: 1,
      elevation: 3,
      flexDirection: 'row',
      gap: 10,
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    pillRow: {
      marginBottom: 10,
    },
    pillText: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '500',
    },
    /* iOS: single grouped card, like a native context menu. */
    cardShadow: {
      backgroundColor: colors.accentBackground,
      borderRadius: 14,
      minWidth: 220,
      shadowColor: colors.black,
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: colorScheme === 'dark' ? 0.6 : 0.22,
      shadowRadius: 18,
    },
    card: {
      borderColor: colors.accentBorder,
      borderRadius: 14,
      borderWidth: StyleSheet.hairlineWidth,
      overflow: 'hidden',
    },
    cardRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 12,
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 13,
    },
    cardRowText: {
      color: colors.text,
      flex: 1,
      fontSize: 16,
    },
    cardSeparator: {
      backgroundColor: colors.accentBorder,
      height: StyleSheet.hairlineWidth,
      marginLeft: 16,
    },
  });

  const rotate = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '45deg'],
  });

  /**
   * Render the Android FAB menu: one pill per item type, staggered out of the button.
   */
  const renderPills = (): React.ReactNode => ITEM_TYPE_OPTIONS.map((option, index) => (
    <Animated.View
      key={option.type}
      style={[
        styles.pillRow,
        {
          opacity: rowProgress[index],
          transform: [
            {
              translateY: rowProgress[index].interpolate({
                inputRange: [0, 1],
                outputRange: [16, 0],
              }),
            },
            {
              scale: rowProgress[index].interpolate({
                inputRange: [0, 1],
                outputRange: [0.85, 1],
              }),
            },
          ],
        },
      ]}
    >
      <RobustPressable
        style={styles.pill}
        onPress={() => handleSelect(option.type)}
        hitSlop={0}
        testID={`add-item-type-${option.type}`}
      >
        <MaterialIcons name={option.icon} size={20} color={colors.primary} />
        <ThemedText style={styles.pillText}>{t(option.titleKey)}</ThemedText>
      </RobustPressable>
    </Animated.View>
  ));

  /**
   * Render the iOS card menu: a single grouped list scaling out of the button corner.
   */
  const renderCard = (): React.ReactNode => (
    <Animated.View
      style={[
        styles.cardShadow,
        {
          opacity: progress,
          transform: [
            {
              translateX: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [14, 0],
              }),
            },
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [18, 0],
              }),
            },
            {
              scale: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [0.85, 1],
              }),
            },
          ],
        },
      ]}
    >
      <View style={styles.card}>
        {ITEM_TYPE_OPTIONS.map((option, index) => (
          <View key={option.type}>
            {index > 0 && <View style={styles.cardSeparator} />}
            <RobustPressable
              style={styles.cardRow}
              onPress={() => handleSelect(option.type)}
              hitSlop={0}
              testID={`add-item-type-${option.type}`}
            >
              <ThemedText style={styles.cardRowText}>{t(option.titleKey)}</ThemedText>
              <MaterialIcons name={option.icon} size={20} color={colors.primary} />
            </RobustPressable>
          </View>
        ))}
      </View>
    </Animated.View>
  );

  return (
    <View
      ref={rootRef}
      style={[StyleSheet.absoluteFill, styles.root]}
      onLayout={measureBackdrop}
      pointerEvents="box-none"
    >
      {isMounted && (
        <>
          <Animated.View style={[styles.backdropBox, styles.scrim, { opacity: progress }]}>
            {Platform.OS === 'ios' && (
              <BlurView
                intensity={18}
                tint={colorScheme === 'dark' ? 'dark' : 'light'}
                style={StyleSheet.absoluteFill}
              />
            )}
          </Animated.View>
          <Pressable
            style={styles.backdropBox}
            onPress={close}
            accessibilityLabel={t('common.close')}
          />

          <View style={styles.menu} pointerEvents="box-none">
            {Platform.OS === 'ios' ? renderCard() : renderPills()}
          </View>
        </>
      )}

      <RobustPressable style={styles.fab} onPress={handleFabPress} testID={testID}>
        <Animated.View style={{ transform: [{ rotate }] }}>
          <MaterialIcons name="add" style={styles.fabIcon} />
        </Animated.View>
      </RobustPressable>
    </View>
  );
};
