import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, View, Text, StyleSheet, Linking, Platform } from 'react-native';
import Toast from 'react-native-toast-message';

import type { Item } from '@/utils/dist/core/models/vault';
import { FieldTypes, getFieldValue, FieldKey } from '@/utils/dist/core/models/vault';
import emitter from '@/utils/EventEmitter';

import { useColors } from '@/hooks/useColorScheme';

import { AliasDetails } from '@/components/items/details/AliasDetails';
import { AttachmentSection } from '@/components/items/details/AttachmentSection';
import { EmailPreview } from '@/components/items/details/EmailPreview';
import { LoginFields } from '@/components/items/details/LoginFields';
import { NotesSection } from '@/components/items/details/NotesSection';
import { TotpSection } from '@/components/items/details/TotpSection';
import { ItemIcon } from '@/components/items/ItemIcon';
import { ThemedContainer } from '@/components/themed/ThemedContainer';
import { ThemedScrollView } from '@/components/themed/ThemedScrollView';
import { ThemedText } from '@/components/themed/ThemedText';
import { ThemedView } from '@/components/themed/ThemedView';
import { HeaderBackButton } from '@/components/ui/HeaderBackButton';
import { RobustPressable } from '@/components/ui/RobustPressable';
import { useDb } from '@/context/DbContext';

/**
 * Item details screen.
 */
export default function ItemDetailsScreen() : React.ReactNode {
  const { id } = useLocalSearchParams();
  const [item, setItem] = useState<Item | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const dbContext = useDb();
  const navigation = useNavigation();
  const colors = useColors();
  const router = useRouter();
  const { t } = useTranslation();

  /**
   * Handle the edit button press.
   */
  const handleEdit = useCallback(() : void => {
    router.push(`/(tabs)/items/add-edit?id=${id}`);
  }, [id, router]);

  // Set header buttons
  useEffect(() => {
    const headerOptions: Record<string, unknown> = {
      /**
       * Header back button.
       */
      headerLeft: (): React.ReactNode => (
        <HeaderBackButton
          label={t('items.title')}
          onPress={() => router.back()}
        />
      ),
      /**
       * Header right button.
       */
      headerRight: (): React.ReactNode => (
        <View style={styles.headerRightContainer}>
          <RobustPressable
            onPress={handleEdit}
            style={styles.headerRightButton}
          >
            <MaterialIcons
              name="edit"
              size={Platform.OS === 'android' ? 24 : 22}
              color={colors.primary}
            />
          </RobustPressable>
        </View>
      ),
    };

    navigation.setOptions(headerOptions);
  }, [navigation, item, handleEdit, colors.primary, router, t]);

  useEffect(() => {
    /**
     * Load the item.
     */
    const loadItem = async () : Promise<void> => {
      if (!dbContext.dbAvailable || !id) {
        return;
      }

      try {
        const result = await dbContext.sqliteClient!.items.getById(id as string);
        setItem(result);
      } catch (err) {
        console.error('Error loading item:', err);
      } finally {
        setIsLoading(false);
      }
    };

    loadItem();

    // Add listener for item changes
    const itemChangedSub = emitter.addListener('credentialChanged', async (changedId: string) => {
      if (changedId === id) {
        await loadItem();
      }
    });

    return () : void => {
      itemChangedSub.remove();
      Toast.hide();
    };
  }, [id, dbContext.dbAvailable, dbContext.sqliteClient]);

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#f97316" />
      </View>
    );
  }

  if (!item) {
    return null;
  }

  // Extract URL fields for display
  const urlFields = item.Fields.filter(field => field.FieldType === FieldTypes.URL && field.Value);

  // Get email for EmailPreview
  const email = getFieldValue(item, FieldKey.LoginEmail);

  /**
   * Render all URL values from URL fields.
   */
  const renderUrls = (): React.ReactNode => {
    if (urlFields.length === 0) {
      return null;
    }

    return (
      <View style={styles.urlContainer}>
        {urlFields.flatMap((urlField) => {
          // Handle both single string and array of strings
          const urlValues = Array.isArray(urlField.Value) ? urlField.Value : [urlField.Value];

          return urlValues.map((urlValue, idx) => {
            const isValidUrl = /^https?:\/\//i.test(urlValue);
            const key = `${urlField.FieldKey}-${idx}`;

            return isValidUrl ? (
              <RobustPressable
                key={key}
                onPress={() => Linking.openURL(urlValue)}
              >
                <Text style={[styles.serviceUrl, { color: colors.primary }]}>
                  {urlValue}
                </Text>
              </RobustPressable>
            ) : (
              <Text key={key} style={[styles.serviceUrl, { color: colors.textMuted }]}>
                {urlValue}
              </Text>
            );
          });
        })}
      </View>
    );
  };

  return (
    <ThemedContainer>
      <ThemedScrollView>
        <ThemedView style={styles.header}>
          <ItemIcon item={item} style={styles.logo} />
          <View style={styles.headerText}>
            <ThemedText type="title" style={styles.serviceName}>
              {item.Name}
            </ThemedText>
            {renderUrls()}
          </View>
        </ThemedView>
        <EmailPreview email={email} />
        <TotpSection item={item} />
        <LoginFields item={item} />
        <AliasDetails item={item} />
        <NotesSection item={item} />
        <AttachmentSection item={item} />
      </ThemedScrollView>
    </ThemedContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  headerRightButton: {
    padding: 10,
  },
  headerRightButtonPressed: {
    padding: 10,
    opacity: 0.8,
  },
  headerRightContainer: {
    flexDirection: 'row',
  },
  headerText: {
    flex: 1,
  },
  loadingContainer: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  logo: {
    borderRadius: 4,
    height: 48,
    width: 48,
  },
  serviceName: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  serviceUrl: {
    fontSize: 14,
  },
  urlContainer: {
    gap: 2,
    marginTop: 2,
  },
});