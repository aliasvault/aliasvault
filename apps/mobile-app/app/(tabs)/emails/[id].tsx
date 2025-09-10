import { Buffer } from 'buffer';

import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system';
import { useLocalSearchParams, useRouter, useNavigation, Stack } from 'expo-router';
import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, ActivityIndicator, Alert, Share, useColorScheme, Linking, Text, TextInput, Platform } from 'react-native';
import { WebView } from 'react-native-webview';

import type { Credential } from '@/utils/dist/shared/models/vault';
import type { Email } from '@/utils/dist/shared/models/webapi';
import EncryptionUtility from '@/utils/EncryptionUtility';
import emitter from '@/utils/EventEmitter';

import { useColors } from '@/hooks/useColorScheme';

import { ThemedText } from '@/components/themed/ThemedText';
import { ThemedView } from '@/components/themed/ThemedView';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { IconSymbolName } from '@/components/ui/IconSymbolName';
import { RobustPressable } from '@/components/ui/RobustPressable';
import { useDb } from '@/context/DbContext';
import { useWebApi } from '@/context/WebApiContext';

/**
 * Email details screen.
 */
export default function EmailDetailsScreen() : React.ReactNode {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const navigation = useNavigation();
  const dbContext = useDb();
  const webApi = useWebApi();
  const colors = useColors();
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState<Email | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isMetadataMaximized, setMetadataMaximized] = useState(false);
  const [isHtmlView, setHtmlView] = useState(true);
  const isDarkMode = useColorScheme() === 'dark';
  const [associatedCredential, setAssociatedCredential] = useState<Credential | null>(null);

  /**
   * Load the email.
   */
  const loadEmail = useCallback(async () : Promise<void> => {
    try {
      setIsLoading(true);
      setError(null);

      if (!dbContext?.sqliteClient || !id) {
        return;
      }

      const response = await webApi.get<Email>(`Email/${id}`);

      // Decrypt email locally using public/private key pairs
      const encryptionKeys = await dbContext.sqliteClient.getAllEncryptionKeys();
      const decryptedEmail = await EncryptionUtility.decryptEmail(response, encryptionKeys);
      setEmail(decryptedEmail);

      // Look up associated credential
      if (decryptedEmail.toLocal && decryptedEmail.toDomain) {
        const emailAddress = `${decryptedEmail.toLocal}@${decryptedEmail.toDomain}`;
        const credential = await dbContext.sqliteClient.getCredentialByEmail(emailAddress);
        setAssociatedCredential(credential);
      }

      // Set initial view mode based on content
      if (decryptedEmail.messageHtml && decryptedEmail.messageHtml.length > 0) {
        setHtmlView(true);
      } else {
        setHtmlView(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('emails.errors.generic'));
    } finally {
      setIsLoading(false);
    }
  }, [dbContext.sqliteClient, id, webApi, t]);

  useEffect(() => {
    loadEmail();
  }, [id, loadEmail]);

  /**
   * Handle the delete button press.
   */
  const handleDelete = useCallback(async () : Promise<void> => {
    Alert.alert(
      t('emails.deleteEmail'),
      t('emails.deleteEmailConfirm'),
      [
        {
          text: t('common.cancel'),
          style: 'cancel',
        },
        {
          text: t('common.delete'),
          style: 'destructive',
          /**
           * Handle the delete button press.
           */
          onPress: async () : Promise<void> => {
            try {
              // Delete the email from the server.
              await webApi.delete(`Email/${id}`);

              // Refresh the emails list in the index screen.
              emitter.emit('refreshEmails');

              // Go back to the emails list screen.
              router.back();
            } catch (err) {
              setError(err instanceof Error ? err.message : t('emails.errors.deleteFailed'));
            }
          },
        },
      ]
    );
  }, [id, router, webApi, t]);

  /**
   * Handle the download attachment button press.
   */
  const handleDownloadAttachment = async (attachment: Email['attachments'][0]) : Promise<void> => {
    try {
      const encryptedBytes = await webApi.downloadBlob(
        `Email/${id}/attachments/${attachment.id}`
      );

      if (!dbContext?.sqliteClient || !email) {
        setError(t('emails.errors.dbNotAvailable'));
        return;
      }

      const encryptionKeys = await dbContext.sqliteClient.getAllEncryptionKeys();
      const decryptedBytes = await EncryptionUtility.decryptAttachment(
        encryptedBytes,
        email,
        encryptionKeys
      );

      if (!decryptedBytes) {
        setError(t('emails.errors.decryptFailed'));
        return;
      }

      // Convert decrypted bytes to base64 for FileSystem.writeAsStringAsync
      const base64Data = Buffer.from(decryptedBytes).toString('base64');
      const tempFile = `${FileSystem.cacheDirectory}${attachment.filename}`;
      await FileSystem.writeAsStringAsync(tempFile, base64Data, {
        encoding: FileSystem.EncodingType.Base64,
      });

      await Share.share({
        url: tempFile,
        title: attachment.filename,
      });

      await FileSystem.deleteAsync(tempFile);
    } catch (err) {
      console.error('handleDownloadAttachment error', err);
      setError(err instanceof Error ? err.message : t('emails.errors.downloadFailed'));
    }
  };

  /**
   * Handle the open credential button press.
   */
  const handleOpenCredential = () : void => {
    if (associatedCredential) {
      router.push(`/(tabs)/credentials/${associatedCredential.Id}`);
    }
  };

  const styles = StyleSheet.create({
    attachment: {
      alignItems: 'center',
      backgroundColor: colors.accentBackground,
      borderRadius: 8,
      flexDirection: 'row',
      marginBottom: 8,
      padding: 12,
    },
    attachmentName: {
      color: colors.textMuted,
      fontSize: 14,
      marginLeft: 8,
    },
    attachments: {
      borderTopColor: colors.accentBorder,
      borderTopWidth: 1,
      padding: 16,
      paddingBottom: 100,
    },
    attachmentsTitle: {
      color: colors.text,
      fontSize: 18,
      fontWeight: 'bold',
      marginBottom: 12,
    },
    centerContainer: {
      alignItems: 'center',
      flex: 1,
      justifyContent: 'center',
      padding: 20,
    },
    container: {
      flex: 1,
    },
    divider: {
      backgroundColor: colors.accentBorder,
      height: 1,
      marginVertical: 2,
    },
    emptyText: {
      color: colors.textMuted,
      opacity: 0.7,
      textAlign: 'center',
    },
    errorText: {
      color: colors.errorBackground,
      textAlign: 'center',
    },
    headerRightButton: {
      padding: 10,
      paddingRight: 10,
    },
    headerRightButtonDelete: {
      paddingRight: 0,
    },
    headerRightContainer: {
      flexDirection: 'row',
    },
    metadataContainer: {
      padding: 2,
    },
    metadataCredential: {
      alignItems: 'center',
      alignSelf: 'center',
      flexDirection: 'row',
    },
    metadataCredentialIcon: {
      marginRight: 4,
    },
    metadataHeading: {
      color: colors.text,
      fontSize: 13,
      fontWeight: 'bold',
      marginBottom: 0,
      marginTop: 0,
      paddingBottom: 0,
      paddingTop: 0,
    },
    metadataIcon: {
      paddingTop: 6,
      width: 30,
    },
    metadataLabel: {
      paddingBottom: 4,
      paddingLeft: 5,
      paddingTop: 4,
      width: 60,
    },
    metadataRow: {
      flexDirection: 'row',
      justifyContent: 'flex-start',
      padding: 2,
    },
    metadataSubject: {
      fontWeight: 'bold',
      textAlign: 'center',
    },
    metadataText: {
      color: colors.text,
      fontSize: 13,
      marginBottom: 0,
      marginTop: 0,
      paddingBottom: 0,
      paddingTop: 0,
    },
    metadataValue: {
      flex: 1,
      paddingBottom: 4,
      paddingLeft: 5,
      paddingTop: 4,
    },
    plainText: {
      flex: 1,
      fontSize: 15,
      padding: 16,
    },
    subject: {
      color: colors.text,
      fontSize: 14,
      fontWeight: 'bold',
      textAlign: 'center',
    },
    subjectContainer: {
      paddingBottom: 8,
      paddingLeft: 5,
      paddingTop: 8,
      width: '90%',
    },
    textDark: {
      color: colors.text,
    },
    textLight: {
      color: colors.text,
    },
    topBox: {
      alignSelf: 'flex-start',
      backgroundColor: colors.background,
      flexDirection: 'row',
      padding: 2,
    },
    webView: {
      flex: 1,
    },
  });

  // Set navigation options
  useEffect(() => {
    navigation.setOptions({
      /**
       * Header right button.
       */
      headerRight: () => (
        <View style={styles.headerRightContainer}>
          <RobustPressable
            onPress={() => setHtmlView(!isHtmlView)}
            style={styles.headerRightButton}
            pressRetentionOffset={10}
            hitSlop={10}
          >
            <Ionicons
              name={isHtmlView ? 'text-outline' : 'document-outline'}
              size={Platform.OS === 'android' ? 24 : 22}
              color={colors.primary}
            />
          </RobustPressable>
          <RobustPressable
            onPress={handleDelete}
            style={[styles.headerRightButton, styles.headerRightButtonDelete]}
            pressRetentionOffset={10}
            hitSlop={10}
          >
            <Ionicons
              name="trash-outline"
              size={Platform.OS === 'android' ? 24 : 22}
              color="#FF0000"
            />
          </RobustPressable>
        </View>
      ),
    });
  }, [isHtmlView, navigation, handleDelete, colors.primary, styles.headerRightButton, styles.headerRightButtonDelete, styles.headerRightContainer]);

  if (isLoading) {
    return (
      <ThemedView style={styles.centerContainer}>
        <Stack.Screen options={{ title: t('emails.emailDetails') }} />
        <ActivityIndicator size="large" />
      </ThemedView>
    );
  }

  if (error) {
    return (
      <ThemedView style={styles.centerContainer}>
        <ThemedText style={styles.errorText}>{t('common.error')}: {error}</ThemedText>
      </ThemedView>
    );
  }

  if (!email) {
    return (
      <ThemedView style={styles.centerContainer}>
        <ThemedText style={styles.emptyText}>{t('emails.emailNotFound')}</ThemedText>
      </ThemedView>
    );
  }

  let metadataView = null;
  if (!isMetadataMaximized) {
    metadataView = (
      <RobustPressable onPress={() => setMetadataMaximized(!isMetadataMaximized)}>
        <View style={styles.topBox}>
          <View style={styles.subjectContainer}>
            <ThemedText style={styles.subject}>{email.subject}</ThemedText>
          </View>
          <View style={styles.metadataIcon}>
            <Ionicons name="reorder-four-outline" size={22} color={isDarkMode ? '#eee' : '#000'} />
          </View>
        </View>
      </RobustPressable>
    );
  } else {
    metadataView = (
      <RobustPressable onPress={() => setMetadataMaximized(!isMetadataMaximized)}>
        <View style={styles.metadataContainer}>
          <View style={styles.metadataRow}>
            <View style={styles.metadataValue}>
              <ThemedText style={[styles.metadataText, styles.metadataSubject]}>{email.subject}</ThemedText>
              {associatedCredential && (
                <View>
                  <RobustPressable
                    onPress={handleOpenCredential}
                    style={styles.metadataCredential}
                  >
                    <IconSymbol size={16} name={IconSymbolName.Key} color={colors.primary} style={styles.metadataCredentialIcon} />
                    <ThemedText style={[styles.metadataText, { color: colors.primary }]}>
                      {associatedCredential.ServiceName}
                    </ThemedText>
                  </RobustPressable>
                </View>
              )}
            </View>
            <View style={styles.metadataIcon}>
              <Ionicons name="chevron-up-outline" size={22} color={isDarkMode ? '#eee' : '#000'} />
            </View>
          </View>
          <View style={styles.divider} />

          <View style={styles.metadataRow}>
            <View style={styles.metadataLabel}>
              <ThemedText style={styles.metadataHeading}>{t('emails.date')}</ThemedText>
            </View>
            <View style={styles.metadataValue}>
              <ThemedText style={styles.metadataText}>
                {new Date(email.dateSystem).toLocaleString()}
              </ThemedText>
            </View>
          </View>
          <View style={styles.divider} />

          <View style={styles.metadataRow}>
            <View style={styles.metadataLabel}>
              <ThemedText style={styles.metadataHeading}>{t('emails.from')}</ThemedText>
            </View>
            <View style={styles.metadataValue}>
              <ThemedText style={styles.metadataText}>
                {email.fromDisplay} ({email.fromLocal}@{email.fromDomain})
              </ThemedText>
            </View>
          </View>
          <View style={styles.divider} />

          <View style={styles.metadataRow}>
            <View style={styles.metadataLabel}>
              <ThemedText style={styles.metadataHeading}>{t('emails.to')}</ThemedText>
            </View>
            <View style={styles.metadataValue}>
              <ThemedText style={styles.metadataText}>
                {email.toLocal}@{email.toDomain}
              </ThemedText>
            </View>
          </View>
          <View style={styles.divider} />
        </View>
      </RobustPressable>
    );
  }

  let emailView = null;
  if (isHtmlView && email.messageHtml) {
    emailView = (
      <WebView
        style={styles.webView}
        source={{ html: email.messageHtml }}
        scrollEnabled={true}
        onNavigationStateChange={(event) => {
          if (event.url !== 'about:blank') {
            // Open the URL in the browser
            Linking.openURL(event.url);
          }
        }}
      />
    );
  } else {
    emailView = Platform.OS === 'ios' ? (
      <TextInput
        multiline
        editable={false}
        selectTextOnFocus={true}
        style={[styles.plainText, isDarkMode ? styles.textDark : styles.textLight]}
        value={email.messagePlain || t('emails.noPlainText')}
      />
    ) : (
      <Text
        selectable
        style={[styles.plainText, isDarkMode ? styles.textDark : styles.textLight]}
      >
        {email.messagePlain || t('emails.noPlainText')}
      </Text>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: t('emails.emailDetails') }} />
      {metadataView}
      {emailView}
      {email.attachments && email.attachments.length > 0 && (
        <View style={styles.attachments}>
          <ThemedText style={styles.attachmentsTitle}>{t('emails.attachments')}</ThemedText>
          {email.attachments.map((attachment) => (
            <RobustPressable
              key={attachment.id}
              style={styles.attachment}
              onPress={() => handleDownloadAttachment(attachment)}
            >
              <Ionicons name="attach" size={20} color="#666" />
              <ThemedText style={styles.attachmentName}>
                {attachment.filename} ({Math.ceil(attachment.filesize / 1024)} {t('emails.sizeKB')})
              </ThemedText>
            </RobustPressable>
          ))}
        </View>
      )}
    </ThemedView>
  );
}