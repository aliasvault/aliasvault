import { type AboutLink, getAboutLinkGroups } from '@aliasvault/client/platform/AboutLinks';
import { AppInfo } from '@aliasvault/client/platform/AppInfo';
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { StyleSheet, View, TouchableOpacity, Linking } from 'react-native';

import { useApiUrl } from '@/utils/ApiUrlUtility';

import { useColors } from '@/hooks/useColorScheme';
import { useDeveloperToolsUnlock } from '@/hooks/useDeveloperToolsUnlock';
import { useTranslation } from '@/hooks/useTranslation';

import { ThemedContainer } from '@/components/themed/ThemedContainer';
import { ThemedScrollView } from '@/components/themed/ThemedScrollView';
import { ThemedText } from '@/components/themed/ThemedText';
import NativeVaultManager from '@/specs/NativeVaultManager';

const LINK_ICONS: Record<AboutLink['id'], keyof typeof Ionicons.glyphMap> = {
  contactSupport: 'chatbubble-ellipses-outline',
  website: 'globe-outline',
  documentation: 'book-outline',
  sourceCode: 'logo-github',
  privacyPolicy: 'shield-checkmark-outline',
  reportIssue: 'bug-outline',
};

/**
 * About screen with the app and server version and links to the website, docs and source code.
 */
export default function AboutScreen(): React.ReactNode {
  const colors = useColors();
  const { t } = useTranslation();
  const { apiUrl, loadApiUrl, getDisplayUrl } = useApiUrl();
  const { registerTap } = useDeveloperToolsUnlock();
  const [serverVersion, setServerVersion] = useState<string | null>(null);
  const [isApiUrlLoaded, setIsApiUrlLoaded] = useState(false);

  useEffect(() => {
    loadApiUrl().then(() => setIsApiUrlLoaded(true));
    NativeVaultManager.getServerVersion().then((version) => setServerVersion(version ?? null));
  }, [loadApiUrl]);

  const styles = StyleSheet.create({
    groupSection: {
      backgroundColor: colors.accentBackground,
      borderRadius: 10,
      marginTop: 8,
      overflow: 'hidden',
    },
    infoRow: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 14,
    },
    infoValue: {
      color: colors.textMuted,
      flexShrink: 1,
      fontSize: 16,
      marginLeft: 16,
      textAlign: 'right',
    },
    itemText: {
      color: colors.text,
      flex: 1,
      fontSize: 16,
    },
    linkIcon: {
      marginRight: 12,
    },
    linksSection: {
      marginTop: 24,
    },
    linkRow: {
      alignItems: 'center',
      flexDirection: 'row',
      paddingHorizontal: 16,
      paddingVertical: 14,
    },
    separator: {
      backgroundColor: colors.accentBorder,
      height: StyleSheet.hairlineWidth,
      marginLeft: 16,
    },
  });

  return (
    <ThemedContainer>
      <ThemedScrollView>
        <View style={styles.groupSection}>
          <TouchableOpacity testID="about-app-version" style={styles.infoRow} onPress={registerTap} activeOpacity={1}>
            <ThemedText style={styles.itemText}>{t('settings.appVersion')}</ThemedText>
            <ThemedText style={styles.infoValue}>{AppInfo.VERSION}</ThemedText>
          </TouchableOpacity>
          {serverVersion && (
            <>
              <View style={styles.separator} />
              <View style={styles.infoRow}>
                <ThemedText style={styles.itemText}>{t('settings.serverVersion')}</ThemedText>
                <ThemedText style={styles.infoValue}>{serverVersion}</ThemedText>
              </View>
            </>
          )}
          <View style={styles.separator} />
          <View style={styles.infoRow}>
            <ThemedText style={styles.itemText}>{t('settings.serverUrl')}</ThemedText>
            <ThemedText style={styles.infoValue} numberOfLines={1} selectable>{getDisplayUrl()}</ThemedText>
          </View>
        </View>

        {getAboutLinkGroups(isApiUrlLoaded ? apiUrl : '').map((group) => (
          <View key={group[0].id} style={[styles.groupSection, styles.linksSection]}>
            {group.map((link, index) => (
              <View key={link.id}>
                {index > 0 && <View style={styles.separator} />}
                <TouchableOpacity style={styles.linkRow} onPress={() => Linking.openURL(link.url)}>
                  <Ionicons name={LINK_ICONS[link.id]} size={20} color={colors.text} style={styles.linkIcon} />
                  <ThemedText style={styles.itemText}>{t(link.labelKey)}</ThemedText>
                  <Ionicons name="open-outline" size={18} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        ))}
      </ThemedScrollView>
    </ThemedContainer>
  );
}
