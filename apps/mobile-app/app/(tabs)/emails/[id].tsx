import { Buffer } from 'buffer';

import { decodeEmailSource, extractEmailAttachment, type ParsedEmailAttachment } from '@aliasvault/client/rust/RustCore';
import { Ionicons } from '@expo/vector-icons';
import { File, Paths } from 'expo-file-system';
import { useLocalSearchParams, useRouter, useNavigation, Stack } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, ActivityIndicator, useColorScheme, Linking, Text, TextInput, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, type WebViewNavigation } from 'react-native-webview';

import ConversionUtility from '@/utils/ConversionUtility';
import type { DisplayItem } from '@/utils/DisplayItem';
import EncryptionUtility, { type DecryptedEmail } from '@/utils/EncryptionUtility';
import emitter from '@/utils/EventEmitter';

import { useAttachmentViewer } from '@/hooks/useAttachmentViewer';
import { useColors } from '@/hooks/useColorScheme';

import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { ThemedText } from '@/components/themed/ThemedText';
import { ThemedView } from '@/components/themed/ThemedView';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { IconSymbolName } from '@/components/ui/IconSymbolName';
import { RobustPressable } from '@/components/ui/RobustPressable';
import { useDb } from '@/context/DbContext';
import { useWebApi } from '@/context/WebApiContext';

import type { Email } from '@aliasvault/models/webapi';

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
  const { openAttachment, viewerElement } = useAttachmentViewer();
  const insets = useSafeAreaInsets();
  const [error, setError] = useState<string | null>(null);
  // The source bytes stay in a ref, out of state; decrypted only records whether there are any.
  const [decrypted, setDecrypted] = useState<(Omit<DecryptedEmail, 'sourceBytes'> & { hasSource: boolean }) | null>(null);
  const sourceBytesRef = useRef<Uint8Array | null>(null);
  const [sourceText, setSourceText] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isMetadataMaximized, setMetadataMaximized] = useState(false);
  const [viewMode, setViewMode] = useState<'html' | 'plain' | 'source'>('html');
  const isDarkMode = useColorScheme() === 'dark';
  const [associatedItem, setAssociatedItem] = useState<DisplayItem | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const email = decrypted?.email ?? null;
  const htmlBody = decrypted?.htmlBody ?? null;
  const textBody = decrypted?.textBody ?? null;
  const hasSource = decrypted?.hasSource ?? false;

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

      // Check if we are in offline mode
      if (dbContext.isOffline) {
        setError(t('emails.offlineMessage'));
        setIsLoading(false);
        return;
      }

      const response = await webApi.get<Email>(`Email/${id}`);

      // Decrypt email locally using public/private key pairs
      const encryptionKeys = await dbContext.sqliteClient.encryptionKeys.getAll();
      const decryptedEmail = await EncryptionUtility.decryptEmail(response, encryptionKeys);
      const { sourceBytes, ...parsedEmail } = decryptedEmail;
      sourceBytesRef.current = sourceBytes;
      setDecrypted({ ...parsedEmail, hasSource: sourceBytes !== null });
      setSourceText(null);

      // Look up associated item
      if (decryptedEmail.email.toLocal && decryptedEmail.email.toDomain) {
        const emailAddress = `${decryptedEmail.email.toLocal}@${decryptedEmail.email.toDomain}`;
        const match = await dbContext.sqliteClient.items.findIdByEmail(emailAddress);
        const item = match ? await dbContext.sqliteClient.items.getById(match.Id) : null;
        setAssociatedItem(item);
      }

      // Set initial view mode based on content: prefer HTML, fall back to plain, then source.
      if (decryptedEmail.htmlBody) {
        setViewMode('html');
      } else if (decryptedEmail.textBody) {
        setViewMode('plain');
      } else if (decryptedEmail.sourceBytes) {
        setViewMode('source');
      }
    } catch (err) {
      /*
       * Suppress errors while vault has unsynced changes
       * Network errors during sync can trigger false positives
       */
      if (dbContext.shouldSuppressEmailErrors()) {
        setIsLoading(false);
        return;
      }

      setError(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setIsLoading(false);
    }
  }, [dbContext, id, webApi, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loadEmail is async; setState only fires after data is fetched
    loadEmail();
  }, [id, loadEmail]);

  /*
   * The raw source is decoded on demand, the first time the source view is opened.
   */
  useEffect(() => {
    const sourceBytes = sourceBytesRef.current;
    if (viewMode !== 'source' || sourceText !== null || !decrypted?.hasSource || !sourceBytes) {
      return;
    }
    decodeEmailSource(sourceBytes)
      .then(decoded => setSourceText(Buffer.from(decoded).toString('utf8')))
      .catch(err => setError(err instanceof Error ? err.message : t('common.errors.unknownError')));
  }, [viewMode, sourceText, decrypted, t]);

  /**
   * Handle the delete button press.
   */
  const handleDelete = useCallback(() : void => {
    setShowDeleteConfirm(true);
  }, []);

  /**
   * Confirm and execute email deletion.
   */
  const confirmDelete = useCallback(async () : Promise<void> => {
    try {
      // Delete the email from the server.
      await webApi.delete(`Email/${id}`);

      // Refresh the emails list in the index screen.
      emitter.emit('refreshEmails');

      // Go back to the emails list screen.
      router.back();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.errors.unknownError'));
    }
    setShowDeleteConfirm(false);
  }, [id, router, webApi, t]);

  /**
   * Hide delete confirmation dialog.
   */
  const hideDeleteConfirm = useCallback((): void => {
    setShowDeleteConfirm(false);
  }, []);

  /**
   * Handle the download attachment button press: the bytes come out of the parsed source, a detached part is
   * fetched and decrypted first.
   */
  const handleDownloadAttachment = async (attachment: ParsedEmailAttachment, index: number) : Promise<void> => {
    try {
      const sourceBytes = sourceBytesRef.current;
      if (!dbContext?.sqliteClient || !email || !sourceBytes) {
        setError(t('common.errors.unknownError'));
        return;
      }

      let detachedBody: Uint8Array | undefined;
      if (attachment.detached && attachment.partIndex !== null) {
        const encryptedPart = await webApi.downloadBlob(`Email/${id}/parts/${attachment.partIndex}`);
        const encryptionKeys = await dbContext.sqliteClient.encryptionKeys.getAll();
        detachedBody = await EncryptionUtility.decryptAttachment(encryptedPart, email, encryptionKeys);
      }

      const decryptedBytes = await extractEmailAttachment(sourceBytes, index, detachedBody);

      const tempFile = new File(Paths.cache, attachment.filename);
      if (tempFile.exists) {
        tempFile.delete();
      }
      tempFile.create();
      tempFile.write(decryptedBytes);

      try {
        await openAttachment({
          filePath: tempFile.uri,
          fileName: attachment.filename,
          mimeType: attachment.mimeType,
        });
      } finally {
        if (tempFile.exists) {
          tempFile.delete();
        }
      }
    } catch (err) {
      console.error('handleDownloadAttachment error', err);
      setError(err instanceof Error ? err.message : t('common.errors.unknownError'));
    }
  };

  /**
   * Open links tapped inside the email body in the external browser.
   */
  const handleShouldStartLoadWithRequest = useCallback((request: WebViewNavigation): boolean => {
    const url = request.url;

    // The email body is injected as static HTML which has no URL of its own, so let that load through.
    if (!url || url === 'about:blank' || url.startsWith('data:') || url.startsWith('file://')) {
      return true;
    }

    Linking.openURL(url).catch(() => {
      // Ignore links the OS has no handler for.
    });

    // Block the navigation so one-time links are only ever opened once, by the external browser.
    return false;
  }, []);

  /**
   * Handle the open item button press.
   */
  const handleOpenItem = () : void => {
    if (associatedItem) {
      router.push(`/(tabs)/items/${associatedItem.Id}`);
    }
  };

  // Only offer the formats the parsed source actually holds.
  const availableModes = useMemo<Array<'html' | 'plain' | 'source'>>(() => {
    const modes: Array<'html' | 'plain' | 'source'> = [];
    if (htmlBody) {
      modes.push('html');
    }
    if (textBody) {
      modes.push('plain');
    }
    if (hasSource) {
      modes.push('source');
    }
    return modes;
  }, [htmlBody, textBody, hasSource]);

  /*
   * A source the parser found no body in is shown as-is plus a notice to update the app, in case a newer
   * server stores a shape this parser does not know yet.
   */
  const isSourceOnly = hasSource && !htmlBody && !textBody;

  const formatLabels = useMemo<Record<'html' | 'plain' | 'source', string>>(() => ({
    html: t('emails.formatHtml'),
    plain: t('emails.formatPlain'),
    source: t('emails.formatSource'),
  }), [t]);

  const cycleViewMode = useCallback((): void => {
    if (availableModes.length <= 1) {
      return;
    }
    const idx = availableModes.indexOf(viewMode);
    const next = availableModes[(idx + 1) % availableModes.length];
    setViewMode(next);
  }, [availableModes, viewMode]);

  const styles = StyleSheet.create({
    attachment: {
      alignItems: 'center',
      backgroundColor: colors.accentBackground,
      borderRadius: 6,
      flexDirection: 'row',
      paddingHorizontal: 10,
      paddingVertical: 6,
    },
    attachmentName: {
      color: colors.textMuted,
      fontSize: 13,
      marginLeft: 6,
    },
    attachments: {
      borderTopColor: colors.accentBorder,
      borderTopWidth: 1,
      gap: 4,
      paddingBottom: Platform.OS === 'ios' ? insets.bottom + 60 : 8,
      paddingHorizontal: 12,
      paddingTop: 8,
    },
    attachmentsTitle: {
      color: colors.text,
      fontSize: 13,
      fontWeight: '600',
      marginBottom: 6,
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
      paddingRight: Platform.OS === 'ios' ? 0 : 10,
    },
    headerRightContainer: {
      alignItems: 'center',
      flexDirection: 'row',
    },
    headerRightFormatLabel: {
      fontSize: 14,
      fontWeight: '600',
    },
    metadataContainer: {
      padding: 2,
    },
    metadataItem: {
      alignItems: 'center',
      alignSelf: 'center',
      flexDirection: 'row',
    },
    metadataItemIcon: {
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
      backgroundColor: '#ffffff',
      color: '#000000',
      flex: 1,
      fontSize: 15,
      padding: 16,
    },
    sourceText: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 12,
    },
    textContainer: {
      backgroundColor: '#ffffff',
      flex: 1,
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
    topBox: {
      alignSelf: 'flex-start',
      backgroundColor: colors.background,
      flexDirection: 'row',
      padding: 2,
    },
    updateNotice: {
      backgroundColor: colors.warningBackground,
      borderColor: colors.warning,
      borderRadius: 6,
      borderWidth: 1,
      margin: 8,
      padding: 10,
    },
    updateNoticeText: {
      color: colors.warning,
      fontSize: 13,
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
          {availableModes.length > 1 && (
            <RobustPressable
              onPress={cycleViewMode}
              style={styles.headerRightButton}
              accessibilityLabel={t('emails.formatSwitchTitle')}
              pressRetentionOffset={5}
              hitSlop={5}
            >
              <Text style={[styles.headerRightFormatLabel, { color: colors.primary }]}>
                {formatLabels[viewMode]}
              </Text>
            </RobustPressable>
          )}
          <RobustPressable
            onPress={handleDelete}
            style={[styles.headerRightButton, styles.headerRightButtonDelete]}
            pressRetentionOffset={5}
            hitSlop={5}
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
  }, [navigation, handleDelete, colors.primary, styles.headerRightButton, styles.headerRightButtonDelete, styles.headerRightContainer, styles.headerRightFormatLabel, availableModes, cycleViewMode, formatLabels, viewMode, t]);

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
              {associatedItem && (
                <View>
                  <RobustPressable
                    onPress={handleOpenItem}
                    style={styles.metadataItem}
                  >
                    <IconSymbol size={16} name={IconSymbolName.Key} color={colors.primary} style={styles.metadataItemIcon} />
                    <ThemedText style={[styles.metadataText, { color: colors.primary }]}>
                      {associatedItem.Name}
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
  if (viewMode === 'html' && htmlBody) {
    // Sanitize HTML
    const sanitizedHtml = ConversionUtility.sanitizeHtmlForEmailViewing(htmlBody);
    emailView = (
      <WebView
        style={styles.webView}
        source={{ html: sanitizedHtml }}
        scrollEnabled={true}
        javaScriptEnabled={false}
        setSupportMultipleWindows={false}
        onShouldStartLoadWithRequest={handleShouldStartLoadWithRequest}
      />
    );
  } else {
    const isSource = viewMode === 'source';
    const text = (isSource ? sourceText ?? t('common.loading') : textBody) ?? '';
    const textStyle = [
      styles.plainText,
      isSource ? styles.sourceText : null,
    ];
    emailView = (
      <View style={styles.textContainer}>
        {Platform.OS === 'ios' ? (
          <TextInput
            multiline
            editable={false}
            selectTextOnFocus={true}
            style={textStyle}
            value={text}
          />
        ) : (
          <Text selectable style={textStyle}>
            {text}
          </Text>
        )}
      </View>
    );
  }

  return (
    <>
      <ThemedView style={styles.container}>
        <Stack.Screen options={{ title: t('emails.emailDetails') }} />
        {metadataView}
        {isSourceOnly && (
          <View style={styles.updateNotice}>
            <ThemedText style={styles.updateNoticeText}>
              {t('emails.updateClientForFormattedView')}
            </ThemedText>
          </View>
        )}
        {emailView}
        {decrypted && decrypted.attachments.length > 0 && (
          <View style={styles.attachments}>
            <ThemedText style={styles.attachmentsTitle}>{t('emails.attachments')}</ThemedText>
            {decrypted.attachments.map((attachment, index) => (
              <RobustPressable
                key={`${index}-${attachment.filename}`}
                style={styles.attachment}
                onPress={() => handleDownloadAttachment(attachment, index)}
              >
                <Ionicons name="attach" size={20} color="#666" />
                <ThemedText style={styles.attachmentName}>
                  {attachment.filename} ({Math.ceil(attachment.size / 1024)} {t('emails.sizeKB')})
                </ThemedText>
              </RobustPressable>
            ))}
          </View>
        )}
      </ThemedView>

      {viewerElement}

      <ConfirmDialog
        isVisible={showDeleteConfirm}
        title={t('emails.deleteEmail')}
        message={t('emails.deleteEmailConfirm')}
        buttons={[
          {
            text: t('common.cancel'),
            style: 'cancel',
            onPress: hideDeleteConfirm,
          },
          {
            text: t('common.delete'),
            style: 'destructive',
            onPress: confirmDelete,
          },
        ]}
        onClose={hideDeleteConfirm}
      />
    </>
  );
}