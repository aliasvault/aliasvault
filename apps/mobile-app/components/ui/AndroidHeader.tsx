import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { View, StyleSheet, Pressable } from 'react-native';

import { useColors } from '@/hooks/useColorScheme';

import Logo from '@/assets/images/logo.svg';
import { ThemedText } from '@/components/themed/ThemedText';

type HeaderButton = {
  icon: keyof typeof MaterialIcons.glyphMap;
  onPress: () => void;
  position: 'left' | 'right';
}

interface IAndroidHeaderProps {
  title: string;
  headerButtons?: HeaderButton[];
  /** Optional callback when title is pressed (enables dropdown mode) */
  onTitlePress?: () => void;
  /** Show dropdown arrow expanded state */
  isDropdownOpen?: boolean;
  /** Optional subtitle shown next to title (e.g., item count) */
  subtitle?: string;
}

/**
 * Custom header component for Android that includes the AliasVault logo.
 * @param {IAndroidHeaderProps} props - The component props
 * @returns {React.ReactNode} The Android header component
 */
export function AndroidHeader({ title, headerButtons = [], onTitlePress, isDropdownOpen, subtitle }: IAndroidHeaderProps): React.ReactNode {
  const colors = useColors();

  const styles = StyleSheet.create({
    dropdownIcon: {
      marginLeft: -4,
    },
    headerButton: {
      padding: 4,
    },
    headerContainer: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 8,
      verticalAlign: 'middle',
    },
    headerTitle: {
      fontSize: 22,
      fontWeight: 'bold',
    },
    headerSubtitle: {
      color: colors.textMuted,
      fontSize: 16,
    },
    leftButton: {
      marginRight: 'auto',
    },
    logo: {
      marginBottom: 0,
    },
    rightButton: {
      marginLeft: 'auto',
    },
    titleContainer: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 4,
    },
  });

  const titleContent = (
    <View style={styles.titleContainer}>
      <ThemedText style={styles.headerTitle}>{title}</ThemedText>
      {subtitle && (
        <ThemedText style={styles.headerSubtitle}>{subtitle}</ThemedText>
      )}
      {onTitlePress && (
        <MaterialIcons
          name={isDropdownOpen ? 'keyboard-arrow-up' : 'keyboard-arrow-down'}
          size={24}
          color={colors.text}
          style={styles.dropdownIcon}
        />
      )}
    </View>
  );

  return (
    <View style={styles.headerContainer}>
      {headerButtons.find(b => b.position === 'left') && (
        <Pressable
          style={[styles.headerButton, styles.leftButton]}
          onPress={headerButtons.find(b => b.position === 'left')?.onPress}
          hitSlop={100}
          android_ripple={{ color: 'lightgray' }}
          pressRetentionOffset={100}
        >
          <MaterialIcons
            name={headerButtons.find(b => b.position === 'left')?.icon ?? 'add'}
            size={28}
            color={colors.primary}
          />
        </Pressable>
      )}
      <Logo width={40} height={40} style={styles.logo} />
      {onTitlePress ? (
        <Pressable
          onPress={onTitlePress}
          android_ripple={{ color: 'lightgray' }}
        >
          {titleContent}
        </Pressable>
      ) : (
        titleContent
      )}
      {headerButtons.find(b => b.position === 'right') && (
        <Pressable
          style={[styles.headerButton, styles.rightButton]}
          onPress={headerButtons.find(b => b.position === 'right')?.onPress}
          hitSlop={100}
          android_ripple={{ color: 'lightgray' }}
          pressRetentionOffset={100}
        >
          <MaterialIcons
            name={headerButtons.find(b => b.position === 'right')?.icon ?? 'add'}
            size={28}
            color={colors.primary}
          />
        </Pressable>
      )}
    </View>
  );
}