import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { router } from 'expo-router';
import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { View, StyleSheet, TouchableOpacity, Linking, AppState } from 'react-native';

import { AppInfo } from '@/utils/AppInfo';
import type { ApiErrorResponse, MailboxEmail } from '@/utils/dist/core/models/webapi';
import EncryptionUtility from '@/utils/EncryptionUtility';

import { useColors } from '@/hooks/useColorScheme';

import { PulseDot } from '@/components/PulseDot';
import { ThemedText } from '@/components/themed/ThemedText';
import { ThemedView } from '@/components/themed/ThemedView';
import { useAuth } from '@/context/AuthContext';
import { useDb } from '@/context/DbContext';
import { useWebApi } from '@/context/WebApiContext';

type EmailPreviewProps = {
  email: string | undefined;
};

/**
 * Email preview component.
 */
export const EmailPreview: React.FC<EmailPreviewProps> = ({ email }) : React.ReactNode => {
  const [emails, setEmails] = useState<MailboxEmail[]>([]);
  const [displayedEmails, setDisplayedEmails] = useState<MailboxEmail[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastEmailId, setLastEmailId] = useState<number>(0);
  const [isSpamOk, setIsSpamOk] = useState(false);
  const [isComponentVisible, setIsComponentVisible] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSupportedDomain, setIsSupportedDomain] = useState(false);
  const [displayedCount, setDisplayedCount] = useState(2);
  const webApi = useWebApi();
  const dbContext = useDb();
  const authContext = useAuth();
  const colors = useColors();
  const { t } = useTranslation();

  const emailsPerLoad = 3;
  const canLoadMore = displayedCount < emails.length;

  /**
   * Updates the displayed emails based on the current count.
   */
  const updateDisplayedEmails = useCallback((allEmails: MailboxEmail[], count: number) => {
    const displayed = allEmails.slice(0, count);
    setDisplayedEmails(displayed);
  }, []);

  /**
   * Loads more emails.
   */
  const loadMoreEmails = useCallback(() => {
    const newCount = Math.min(displayedCount + emailsPerLoad, emails.length);
    setDisplayedCount(newCount);
    updateDisplayedEmails(emails, newCount);
  }, [displayedCount, emails, emailsPerLoad, updateDisplayedEmails]);

  /**
   * Check if the email is a public domain.
   */
  const isPublicDomain = useCallback(async (emailAddress: string): Promise<boolean> => {
    // Get public domains from stored metadata
    const metadata = await dbContext?.sqliteClient?.getVaultMetadata();
    if (!metadata) {
      return false;
    }

    return metadata.publicEmailDomains.includes(emailAddress.split('@')[1]);
  }, [dbContext]);

  /**
   * Check if the email is a private domain (including hidden domains).
   */
  const isPrivateDomain = useCallback(async (emailAddress: string): Promise<boolean> => {
    // Get private domains from stored metadata
    const metadata = await dbContext?.sqliteClient?.getVaultMetadata();
    if (!metadata) {
      return false;
    }

    const domain = emailAddress.split('@')[1];
    return metadata.privateEmailDomains.includes(domain) ||
           (metadata.hiddenPrivateEmailDomains || []).includes(domain);
  }, [dbContext]);

  // Handle app state changes
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState): void => {
      setIsComponentVisible(nextAppState === 'active');
    });

    return (): void => {
      subscription.remove();
    };
  }, []);

  // Handle focus changes
  useFocusEffect(
    useCallback((): (() => void) => {
      setIsComponentVisible(true);
      return (): void => {
        setIsComponentVisible(false);
      };
    }, [])
  );

  useEffect(() => {
    /**
     * Load the emails.
     */
    const loadEmails = async () : Promise<void> => {
      try {
        if (!email || !isComponentVisible) {
          return;
        }

        // Check if we are in offline mode, if so, we don't need to load emails from the server
        const isOffline = authContext.isOffline;
        if (isOffline) {
          return;
        }

        const isPublic = await isPublicDomain(email);
        const isPrivate = await isPrivateDomain(email);
        const isSupported = isPublic || isPrivate;

        setIsSpamOk(isPublic);
        setIsSupportedDomain(isSupported);

        if (!isSupported) {
          return;
        }

        if (isPublic) {
          // For public domains (SpamOK), use the SpamOK API directly
          const emailPrefix = email.split('@')[0];
          const response = await fetch(`https://api.spamok.com/v2/EmailBox/${emailPrefix}`, {
            headers: {
              'X-Asdasd-Platform-Id': 'av-mobile',
              'X-Asdasd-Platform-Version': AppInfo.VERSION,
            }
          });

          if (!response.ok) {
            setError(t('credentials.emailLoadError'));
            return;
          }

          const data = await response.json();

          // Store all emails, sorted by date
          const allMails = data?.mails
            ?.sort((a: MailboxEmail, b: MailboxEmail) =>
              new Date(b.dateSystem).getTime() - new Date(a.dateSystem).getTime()) ?? [];

          if (loading && allMails.length > 0) {
            setLastEmailId(allMails[0].id);
          }

          setEmails(allMails);
          updateDisplayedEmails(allMails, displayedCount);
        } else if (isPrivate) {
          // For private domains, use existing encrypted email logic
          if (!dbContext?.sqliteClient) {
            return;
          }

          try {
            // Get all encryption keys
            const encryptionKeys = await dbContext.sqliteClient.getAllEncryptionKeys();

            // Use single emailbox operator instead of bulk
            const response = await webApi.authFetch(`EmailBox/${email}`, { method: 'GET' }, true, false);
            try {
              const data = response as { mails: MailboxEmail[] };

              // Store all emails, sorted by date
              const allMails = data.mails
                .sort((a, b) => new Date(b.dateSystem).getTime() - new Date(a.dateSystem).getTime());

              if (allMails) {
                // Loop through all emails and decrypt them locally
                const decryptedEmails = await EncryptionUtility.decryptEmailList(
                  allMails,
                  encryptionKeys
                );

                if (loading && decryptedEmails.length > 0) {
                  setLastEmailId(decryptedEmails[0].id);
                }

                setEmails(decryptedEmails);
                updateDisplayedEmails(decryptedEmails, displayedCount);

                // Reset error
                setError(null);
              }
            } catch {
              // Try to parse as error response instead
              const apiErrorResponse = response as ApiErrorResponse;
              setError(t(`apiErrors.${apiErrorResponse?.code}`));
              return;
            }
          } catch {
            setError(t('credentials.emailLoadError'));
          }
        }
      } catch (err) {
        console.error('Error loading emails:', err);
        setError(t('credentials.emailUnexpectedError'));
      } finally {
        setLoading(false);
      }
    };

    loadEmails();
    // Set up auto-refresh interval only when component is visible
    const interval = isComponentVisible ? setInterval(loadEmails, 2000) : null;
    return () : void => {
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [email, loading, webApi, dbContext, isPublicDomain, isPrivateDomain, authContext.isOffline, isComponentVisible, t, displayedCount, updateDisplayedEmails]);

  const styles = StyleSheet.create({
    date: {
      color: colors.textMuted,
      fontSize: 12,
      opacity: 0.7,
    },
    emailItem: {
      backgroundColor: colors.accentBackground,
      borderColor: colors.accentBorder,
      borderRadius: 8,
      borderWidth: 1,
      marginBottom: 6,
      marginTop: 8,
      padding: 12,
    },
    errorContainer: {
      backgroundColor: colors.errorBackground,
      borderColor: colors.errorBorder,
      borderRadius: 8,
      borderWidth: 1,
      marginTop: 8,
      padding: 12,
    },
    errorText: {
      color: colors.errorText,
      fontSize: 14,
    },
    loadMoreButton: {
      alignItems: 'center',
      backgroundColor: colors.accentBackground,
      borderRadius: 8,
      flexDirection: 'row',
      gap: 6,
      justifyContent: 'center',
      marginTop: 8,
      paddingHorizontal: 16,
      paddingVertical: 10,
    },
    loadMoreText: {
      color: colors.textMuted,
      fontSize: 14,
      fontWeight: '500',
    },
    placeholderText: {
      color: colors.textMuted,
      marginBottom: 8,
    },
    section: {
      paddingTop: 16,
    },
    subject: {
      color: colors.text,
      fontSize: 16,
      fontWeight: 'bold',
    },
    title: {
      color: colors.text,
      fontSize: 20,
      fontWeight: 'bold',
    },
    titleContainer: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 8,
    },
  });

  // Sanity check: if no email is provided, don't render anything.
  if (!email) {
    return null;
  }

  // Don't render anything if the domain is not supported
  if (!isSupportedDomain) {
    return null;
  }

  if (error) {
    return (
      <ThemedView style={styles.section}>
        <View style={styles.titleContainer}>
          <ThemedText type="title" style={styles.title}>{t('credentials.recentEmails')}</ThemedText>
        </View>
        <View style={styles.errorContainer}>
          <ThemedText style={styles.errorText}>{error}</ThemedText>
        </View>
      </ThemedView>
    );
  }

  if (loading) {
    return (
      <ThemedView style={styles.section}>
        <View style={styles.titleContainer}>
          <ThemedText type="title" style={styles.title}>{t('credentials.recentEmails')}</ThemedText>
          <PulseDot />
        </View>
        <ThemedText style={styles.placeholderText}>{t('credentials.loadingEmails')}</ThemedText>
      </ThemedView>
    );
  }

  if (authContext.isOffline) {
    return (
      <ThemedView style={styles.section}>
        <View style={styles.titleContainer}>
          <ThemedText type="title" style={styles.title}>{t('credentials.recentEmails')}</ThemedText>
        </View>
        <ThemedText style={styles.placeholderText}>{t('credentials.offlineEmailsMessage')}</ThemedText>
      </ThemedView>
    );
  }

  if (emails.length === 0) {
    return (
      <ThemedView style={styles.section}>
        <View style={styles.titleContainer}>
          <ThemedText type="title" style={styles.title}>{t('credentials.recentEmails')}</ThemedText>
          <PulseDot />
        </View>
        <ThemedText style={styles.placeholderText}>{t('credentials.noEmailsYet')}</ThemedText>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.section}>
      <View style={styles.titleContainer}>
        <ThemedText type="title" style={styles.title}>{t('credentials.recentEmails')}</ThemedText>
        <PulseDot />
      </View>
      {displayedEmails.map((mail) => (
        <TouchableOpacity
          key={mail.id}
          style={[
            styles.emailItem,
            mail.id > lastEmailId && { backgroundColor: colors.accentBackground }
          ]}
          onPress={() => {
            if (isSpamOk) {
              const emailPrefix = email.split('@')[0];
              Linking.openURL(`https://spamok.com/${emailPrefix}/${mail.id}`);
            } else {
              router.push(`/(tabs)/items/email/${mail.id}`);
            }
          }}
        >
          <ThemedText style={styles.subject} numberOfLines={1}>
            {mail.subject}
          </ThemedText>
          <ThemedText style={styles.date}>
            {new Date(mail.dateSystem).toLocaleDateString()}
          </ThemedText>
        </TouchableOpacity>
      ))}
      {canLoadMore && (
        <TouchableOpacity style={styles.loadMoreButton} onPress={loadMoreEmails}>
          <ThemedText style={styles.loadMoreText}>{t('common.loadMore')}</ThemedText>
          <MaterialIcons name="keyboard-arrow-down" size={16} color={colors.textMuted} />
        </TouchableOpacity>
      )}
    </ThemedView>
  );
};