import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { Credential } from '@/utils/dist/core/models/vault';
import type { MailboxEmail } from '@/utils/dist/core/models/webapi';

import { useColors } from '@/hooks/useColorScheme';
import { useTranslation } from '@/hooks/useTranslation';

import { ThemedText } from '@/components/themed/ThemedText';
import { RobustPressable } from '@/components/ui/RobustPressable';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { IconSymbolName } from '@/components/ui/IconSymbolName';
import { useDb } from '@/context/DbContext';

type EmailCardProps = {
  email: MailboxEmail;
};

/**
 * Email card component.
 */
export function EmailCard({ email }: EmailCardProps) : React.ReactNode {
  const colors = useColors();
  const { t } = useTranslation();
  const dbContext = useDb();
  const [associatedCredential, setAssociatedCredential] = useState<Credential | null>(null);

  /**
   * Load the associated credential for this email.
   */
  useEffect(() => {
    /**
     * Load the credential associated with the email's recipient address.
     */
    const loadCredential = async (): Promise<void> => {
      if (!dbContext?.sqliteClient || !email.toLocal || !email.toDomain) {
        return;
      }

      const emailAddress = `${email.toLocal}@${email.toDomain}`;
      const credential = await dbContext.sqliteClient.getCredentialByEmail(emailAddress);
      setAssociatedCredential(credential);
    };

    loadCredential();
  }, [dbContext?.sqliteClient, email.toLocal, email.toDomain]);

  /**
   * Format the email date.
   */
  const formatEmailDate = (dateSystem: string): string => {
    const now = new Date();
    const emailDate = new Date(dateSystem);
    const secondsAgo = Math.floor((now.getTime() - emailDate.getTime()) / 1000);

    if (secondsAgo < 60) {
      return t('emails.time.justNow');
    } else if (secondsAgo < 3600) {
      const minutes = Math.floor(secondsAgo / 60);
      if (minutes === 1) {
        return t('emails.time.minutesAgo_single', { count: minutes });
      } else {
        return t('emails.time.minutesAgo_plural', { count: minutes });
      }
    } else if (secondsAgo < 86400) {
      const hours = Math.floor(secondsAgo / 3600);
      if (hours === 1) {
        return t('emails.time.hoursAgo_single', { count: hours });
      } else {
        return t('emails.time.hoursAgo_plural', { count: hours });
      }
    } else if (secondsAgo < 172800) {
      return t('emails.time.yesterday');
    } else {
      return emailDate.toLocaleDateString('en-GB', {
        day: '2-digit',
        month: '2-digit'
      });
    }
  };

  const styles = StyleSheet.create({
    emailCard: {
      backgroundColor: colors.accentBackground,
      borderRadius: 8,
      elevation: 3,
      marginBottom: 12,
      padding: 12,
      shadowColor: colors.text,
      shadowOffset: {
        width: 0,
        height: 2,
      },
      shadowOpacity: 0.1,
      shadowRadius: 3,
    },
    emailDate: {
      color: colors.textMuted,
      fontSize: 12,
      opacity: 0.6,
    },
    emailHeader: {
      alignItems: 'flex-start',
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: 8,
    },
    emailPreview: {
      color: colors.text,
      fontSize: 14,
      opacity: 0.8,
    },
    emailSubject: {
      color: colors.text,
      flex: 1,
      fontSize: 16,
      fontWeight: 'bold',
      marginRight: 8,
    },
    serviceContainer: {
      alignItems: 'center',
      flexDirection: 'row',
      marginTop: 4,
    },
    serviceIcon: {
      marginRight: 4,
    },
    serviceName: {
      color: colors.primary,
      fontSize: 12,
    },
  });

  return (
    <RobustPressable
      style={styles.emailCard}
      onPress={() => router.push(`/(tabs)/emails/${email.id}`)}
    >
      <View style={styles.emailHeader}>
        <ThemedText style={styles.emailSubject} numberOfLines={1}>
          {email.subject}
        </ThemedText>
        <ThemedText style={styles.emailDate}>
          {formatEmailDate(email.dateSystem)}
        </ThemedText>
      </View>
      <ThemedText style={styles.emailPreview} numberOfLines={2}>
        {email.messagePreview}
      </ThemedText>
      {associatedCredential && (
        <View style={styles.serviceContainer}>
          <IconSymbol size={14} name={IconSymbolName.Key} color={colors.primary} style={styles.serviceIcon} />
          <ThemedText style={styles.serviceName}>
            {associatedCredential.ServiceName}
          </ThemedText>
        </View>
      )}
    </RobustPressable>
  );
}