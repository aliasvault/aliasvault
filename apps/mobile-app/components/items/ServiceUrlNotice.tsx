import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useRouter } from 'expo-router';
import { StyleSheet, TouchableOpacity } from 'react-native';

import { extractServiceNameFromUrl } from '@/utils/UrlUtility';

import { useColors } from '@/hooks/useColorScheme';
import { useTranslation } from '@/hooks/useTranslation';

import { ThemedText } from '@/components/themed/ThemedText';
import { ThemedView } from '@/components/themed/ThemedView';

interface IServiceUrlNoticeProps {
  serviceUrl: string;
  onDismiss: () => void;
}

/**
 * A dismissable notice that appears when a service URL is provided via deep link.
 * Clicking the notice navigates to the add-edit page with the service URL.
 */
export function ServiceUrlNotice({ serviceUrl, onDismiss }: IServiceUrlNoticeProps): React.ReactNode {
  const router = useRouter();
  const colors = useColors();
  const { t } = useTranslation();
  const serviceName = extractServiceNameFromUrl(serviceUrl);

  /**
   * Handle press on the notice to navigate to add-edit page
   */
  const handlePress = (): void => {
    router.push({
      pathname: '/(tabs)/items/add-edit',
      params: { serviceUrl }
    });
  };

  const styles = StyleSheet.create({
    container: {
      alignItems: 'center',
      backgroundColor: colors.accentBackground,
      borderRadius: 8,
      flexDirection: 'row',
      marginBottom: 16,
      padding: 12,
    },
    content: {
      alignItems: 'center',
      flex: 1,
      flexDirection: 'row',
      gap: 8,
    },
    dismissButton: {
      padding: 4,
    },
    text: {
      flex: 1,
      fontSize: 14,
    },
  });

  return (
    <ThemedView style={styles.container}>
      <TouchableOpacity
        style={styles.content}
        onPress={handlePress}
      >
        <MaterialIcons name="add-circle" size={20} color={colors.primary} />
        <ThemedText style={styles.text}>
          {t('items.createNewAliasFor')} &ldquo;{serviceName}&rdquo;?
        </ThemedText>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.dismissButton}
        onPress={onDismiss}
      >
        <MaterialIcons name="close" size={20} color={colors.textMuted} />
      </TouchableOpacity>
    </ThemedView>
  );
}