import { BlurView } from 'expo-blur';
import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { useColors, useColorScheme } from '@/hooks/useColorScheme';

/**
 * Tinted, blurred backdrop shared by every modal. Render it as the first child of the full-screen overlay.
 * The blur is iOS only: Android blur needs a blur target and is too costly for a modal backdrop.
 */
export const ModalBackdrop: React.FC = () => {
  const colors = useColors();
  const colorScheme = useColorScheme();

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {Platform.OS === 'ios' && (
        <BlurView intensity={20} tint={colorScheme === 'dark' ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
      )}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.modalBackground }]} />
    </View>
  );
};

export default ModalBackdrop;
