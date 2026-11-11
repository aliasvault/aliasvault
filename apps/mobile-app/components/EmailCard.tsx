import { MaterialIcons } from '@expo/vector-icons';
import { memo, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { type ContextMenuOnPressNativeEvent } from 'react-native-context-menu-view';

import type { NativeSyntheticEvent } from 'react-native';

import type { DisplayItem } from '@/utils/DisplayItem';
import type { MailboxEmail } from '@aliasvault/models/webapi';

import { useColors } from '@/hooks/useColorScheme';
import { useNavigationDebounce } from '@/hooks/useNavigationDebounce';
import { usePaneRouter } from '@/hooks/usePaneRouter';
import { useIsSelectedRoute } from '@/hooks/useTwoPane';
import { useTranslation } from '@/hooks/useTranslation';

import { SelectableListRow } from '@/components/common/SelectableListRow';
import { ThemedText } from '@/components/themed/ThemedText';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { IconSymbolName } from '@/components/ui/IconSymbolName';
import { useDb } from '@/context/DbContext';

type EmailCardProps = {
  email: MailboxEmail;
  selectionMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (email: MailboxEmail) => void;
  onSelectFromMenu?: (email: MailboxEmail) => void;
  onDelete?: (emailId: number) => void;
};

/**
 * Email card component.
 */
function EmailCardComponent({ email, selectionMode = false, isSelected = false, onToggleSelect, onSelectFromMenu, onDelete }: EmailCardProps) : React.ReactNode {
  const colors = useColors();
  const { t } = useTranslation();
  const navigate = useNavigationDebounce();
  const paneRouter = usePaneRouter();
  const href = { pathname: '/(tabs)/emails/[id]', params: { id: String(email.id), subject: email.subject } } as const;
  const isActive = useIsSelectedRoute(href);
  const dbContext = useDb();
  const [associatedItem, setAssociatedItem] = useState<DisplayItem | null>(null);

  /**
   * Load the associated item for this email.
   */
  useEffect(() => {
    /**
     * Load the item associated with the email's recipient address.
     */
    const loadItem = async (): Promise<void> => {
      if (!dbContext?.sqliteClient || !email.toLocal || !email.toDomain) {
        return;
      }

      const emailAddress = `${email.toLocal}@${email.toDomain}`;
      const match: { Id: string; ManifestId?: string } | null = await dbContext.sqliteClient.items.findIdByEmail(emailAddress);
      const item = match?.ManifestId ? await dbContext.sqliteClient.items.getById({ Id: match.Id, ManifestId: match.ManifestId }) : null;
      setAssociatedItem(item);
    };

    loadItem();
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

  /**
   * Open the email.
   */
  const openEmail = (): void => {
    navigate(() => paneRouter.openDetail(href, { reuseScreen: true }));
  };

  /**
   * Run the context menu entry that was picked.
   */
  const handleContextMenuAction = (event: NativeSyntheticEvent<ContextMenuOnPressNativeEvent>): void => {
    if (event.nativeEvent.name === t('common.open')) {
      openEmail();
    } else if (event.nativeEvent.name === t('common.select')) {
      onSelectFromMenu?.(email);
    } else if (event.nativeEvent.name === t('common.delete')) {
      onDelete?.(email.id);
    }
  };

  const styles = StyleSheet.create({
    attachmentIcon: {
      marginRight: 2,
      opacity: 0.6,
    },
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
    emailCardActive: {
      backgroundColor: colors.selectedRowBackground,
    },
    emailHeader: {
      alignItems: 'flex-start',
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: 8,
    },
    emailMeta: {
      alignItems: 'center',
      flexDirection: 'row',
      flexShrink: 0,
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

  const menu = onDelete ? {
    actions: [
      { title: '', inlineChildren: true, actions: [
        { title: t('common.open'), systemIcon: 'eye' },
        ...(onSelectFromMenu && !selectionMode ? [{ title: t('common.select'), systemIcon: 'checkmark.circle' }] : []),
      ] },
      { title: '', inlineChildren: true, actions: [{ title: t('common.delete'), systemIcon: 'trash', destructive: true }] },
    ],
    onPress: handleContextMenuAction,
  } : undefined;

  return (
    <SelectableListRow
      style={[styles.emailCard, isActive && styles.emailCardActive]}
      selectionMode={selectionMode}
      isSelected={isSelected}
      onToggleSelect={onToggleSelect ? () => onToggleSelect(email) : undefined}
      onOpen={openEmail}
      menu={menu}
      checkboxAlign="top"
    >
      <View style={styles.emailHeader}>
        <ThemedText style={styles.emailSubject} numberOfLines={1}>
          {email.subject}
        </ThemedText>
        <View style={styles.emailMeta}>
          {email.hasAttachments && (
            <MaterialIcons name="attach-file" size={14} color={colors.textMuted} style={styles.attachmentIcon} />
          )}
          <ThemedText style={styles.emailDate}>
            {formatEmailDate(email.dateSystem)}
          </ThemedText>
        </View>
      </View>
      <ThemedText style={styles.emailPreview} numberOfLines={2}>
        {email.messagePreview}
      </ThemedText>
      {associatedItem && (
        <View style={styles.serviceContainer}>
          <IconSymbol size={14} name={IconSymbolName.Key} color={colors.primary} style={styles.serviceIcon} />
          <ThemedText style={styles.serviceName}>
            {associatedItem.Name}
          </ThemedText>
        </View>
      )}
    </SelectableListRow>
  );
}

/** Re-renders only when its own props change, so toggling one row leaves the others alone. */
export const EmailCard = memo(EmailCardComponent);
