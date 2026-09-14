import { Ionicons } from '@expo/vector-icons';
import { Href, router } from 'expo-router';
import { useCallback } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { useColors } from '@/hooks/useColorScheme';
import { useDeveloperToolsUnlock } from '@/hooks/useDeveloperToolsUnlock';
import { useNavigationDebounce } from '@/hooks/useNavigationDebounce';

import { ThemedButton } from '@/components/themed/ThemedButton';
import { ThemedContainer } from '@/components/themed/ThemedContainer';
import { ThemedScrollView } from '@/components/themed/ThemedScrollView';
import { ThemedText } from '@/components/themed/ThemedText';

/**
 * A debug page listed in the developer tools menu.
 */
type DeveloperToolsPage = {
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  route: Href;
};

const developerToolsPages: DeveloperToolsPage[] = [
  { title: 'Sync logs', icon: 'pulse-outline', route: '/(tabs)/settings/developer-tools/sync-logs' },
  { title: 'App review prompt', icon: 'star-outline', route: '/(tabs)/settings/developer-tools/app-review' },
];

/**
 * Developer tools menu: every debug page, and the switch to hide the tools again. Note: not required to be translated.
 */
export default function DeveloperToolsScreen(): React.ReactNode {
  const colors = useColors();
  const navigate = useNavigationDebounce();
  const { hide: hideDeveloperTools } = useDeveloperToolsUnlock();

  /**
   * Hide the developer tools again.
   */
  const handleHideDeveloperTools = useCallback(async (): Promise<void> => {
    await hideDeveloperTools();
    router.back();
  }, [hideDeveloperTools]);

  const styles = StyleSheet.create({
    buttonSecondary: {
      marginTop: 24,
      backgroundColor: colors.accentBackground,
    },
    headerText: {
      color: colors.textMuted,
      fontSize: 13,
      lineHeight: 20,
    },
    section: {
      backgroundColor: colors.accentBackground,
      borderRadius: 10,
      marginTop: 16,
      overflow: 'hidden',
    },
    separator: {
      backgroundColor: colors.accentBorder,
      height: StyleSheet.hairlineWidth,
      marginLeft: 52,
    },
    settingItem: {
      alignItems: 'center',
      backgroundColor: colors.accentBackground,
      flexDirection: 'row',
      paddingHorizontal: 16,
      paddingVertical: 6,
    },
    settingItemContent: {
      alignItems: 'center',
      flex: 1,
      flexDirection: 'row',
      paddingVertical: 10,
    },
    settingItemIcon: {
      alignItems: 'center',
      height: 24,
      justifyContent: 'center',
      marginRight: 12,
      width: 24,
    },
    settingItemText: {
      color: colors.text,
      flex: 1,
      fontSize: 16,
    },
  });

  return (
    <ThemedContainer>
      <ThemedScrollView>
        <ThemedText style={styles.headerText}>
          These tools are for development and manual testing purposes.
        </ThemedText>

        <View style={styles.section}>
          {developerToolsPages.map((page, index) => (
            <View key={page.title}>
              {index > 0 && <View style={styles.separator} />}
              <TouchableOpacity
                style={styles.settingItem}
                onPress={() => navigate(() => router.push(page.route))}
              >
                <View style={styles.settingItemIcon}>
                  <Ionicons name={page.icon} size={20} color={colors.text} />
                </View>
                <View style={styles.settingItemContent}>
                  <ThemedText style={styles.settingItemText}>{page.title}</ThemedText>
                  <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
                </View>
              </TouchableOpacity>
            </View>
          ))}
        </View>

        <ThemedButton
          style={styles.buttonSecondary}
          title="Hide developer tools"
          onPress={handleHideDeveloperTools}
        />
      </ThemedScrollView>
    </ThemedContainer>
  );
}
