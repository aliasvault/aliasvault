import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, Text, TouchableOpacity, Keyboard, Platform, Alert } from 'react-native';
import ContextMenu, { OnPressMenuItemEvent } from 'react-native-context-menu-view';
import Toast from 'react-native-toast-message';

import { copyToClipboardWithExpiration } from '@/utils/ClipboardUtility';
import type { Credential } from '@/utils/dist/core/models/vault';

import { useColors } from '@/hooks/useColorScheme';

import { CredentialIcon } from '@/components/credentials/CredentialIcon';
import { useAuth } from '@/context/AuthContext';

type CredentialCardProps = {
  credential: Credential;
  onCredentialDelete?: (credentialId: string) => Promise<void>;
};

/**
 * Credential card component.
 */
export function CredentialCard({ credential, onCredentialDelete }: CredentialCardProps) : React.ReactNode {
  const colors = useColors();
  const { t } = useTranslation();
  const { getClipboardClearTimeout } = useAuth();

  /**
   * Get the display text for a credential, showing username by default,
   * falling back to email only if username is null/undefined/empty
   */
  const getCredentialDisplayText = (cred: Credential): string => {
    let returnValue = '';

    // Show username if available
    if (cred.Username) {
      returnValue = cred.Username;
    }

    // Show email if username is not available
    if (cred.Alias?.Email) {
      returnValue = cred.Alias.Email;
    }

    // Trim the return value to max. 38 characters.
    return returnValue.length > 38 ? returnValue.slice(0, 35) + '...' : returnValue;
  };

  /**
   * Get the service name for a credential, trimming it to maximum length so it doesn't overflow the UI.
   */
  const getCredentialServiceName = (cred: Credential): string => {
    let returnValue = 'Untitled';

    if (cred.ServiceName) {
      returnValue = cred.ServiceName;
    }

    // Trim the return value to max. 33 characters.
    return returnValue.length > 33 ? returnValue.slice(0, 30) + '...' : returnValue;
  };

  /**
   * Helper function to copy text to clipboard with auto-clear
   */
  const copyToClipboard = async (text: string): Promise<void> => {
    try {
      // Get clipboard clear timeout from settings
      const timeoutSeconds = await getClipboardClearTimeout();

      // Use centralized clipboard utility
      await copyToClipboardWithExpiration(text, timeoutSeconds);
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
    }
  };

  /**
   * Handles the context menu action when an item is selected.
   * @param event - The event object containing the selected action details
   */
  const handleContextMenuAction = async (event: OnPressMenuItemEvent): Promise<void> => {
    const { name } = event.nativeEvent;

    switch (name) {
      case t('credentials.contextMenu.edit'):
        Keyboard.dismiss();
        router.push({
          pathname: '/(tabs)/credentials/add-edit',
          params: { id: credential.Id }
        });
        break;
      case t('credentials.contextMenu.delete'):
        Keyboard.dismiss();
        Alert.alert(
          t('credentials.deleteCredential'),
          t('credentials.deleteConfirm'),
          [
            {
              text: t('common.cancel'),
              style: "cancel"
            },
            {
              text: t('common.delete'),
              style: "destructive",
              /**
               * Handles the delete credential action.
               */
              onPress: async () : Promise<void> => {
                if (onCredentialDelete) {
                  await onCredentialDelete(credential.Id);
                }
              }
            }
          ]
        );
        break;
      case t('credentials.contextMenu.copyUsername'):
        if (credential.Username) {
          await copyToClipboard(credential.Username);
          if (Platform.OS === 'ios') {
            Toast.show({
              type: 'success',
              text1: t('credentials.toasts.usernameCopied'),
              position: 'bottom',
            });
          }
        }
        break;
      case t('credentials.contextMenu.copyEmail'):
        if (credential.Alias?.Email) {
          await copyToClipboard(credential.Alias.Email);
          if (Platform.OS === 'ios') {
            Toast.show({
              type: 'success',
              text1: t('credentials.toasts.emailCopied'),
              position: 'bottom',
            });
          }
        }
        break;
      case t('credentials.contextMenu.copyPassword'):
        if (credential.Password) {
          await copyToClipboard(credential.Password);
          if (Platform.OS === 'ios') {
            Toast.show({
              type: 'success',
              text1: t('credentials.toasts.passwordCopied'),
              position: 'bottom',
            });
          }
        }
        break;
    }
  };

  /**
   * Gets the menu actions for the context menu based on available credential data.
   * @returns Array of menu action objects with title and icon
   */
  const getMenuActions = (): {
    title: string;
    systemIcon: string;
    destructive?: boolean;
  }[] => {
    const actions = [
      {
        title: t('credentials.contextMenu.edit'),
        systemIcon: Platform.select({
          ios: 'pencil',
          android: 'baseline_edit',
        }),
      },
      {
        title: t('credentials.contextMenu.delete'),
        systemIcon: Platform.select({
          ios: 'trash',
          android: 'baseline_delete',
        }),
        destructive: true,
      },
    ];

    if (credential.Username) {
      actions.push({
        title: t('credentials.contextMenu.copyUsername'),
        systemIcon: Platform.select({
          ios: 'person',
          android: 'baseline_person',
        }),
      });
    }

    if (credential.Alias?.Email) {
      actions.push({
        title: t('credentials.contextMenu.copyEmail'),
        systemIcon: Platform.select({
          ios: 'envelope',
          android: 'baseline_email',
        }),
      });
    }

    if (credential.Password) {
      actions.push({
        title: t('credentials.contextMenu.copyPassword'),
        systemIcon: Platform.select({
          ios: 'key',
          android: 'baseline_key',
        }),
      });
    }

    return actions;
  };

  const styles = StyleSheet.create({
    credentialCard: {
      backgroundColor: colors.accentBackground,
      borderRadius: 8,
      marginBottom: 8,
      padding: 12,
    },
    credentialContent: {
      alignItems: 'center',
      flexDirection: 'row',
    },
    credentialInfo: {
      flex: 1,
    },
    credentialText: {
      color: colors.textMuted,
      fontSize: 14,
    },
    logo: {
      borderRadius: 4,
      height: 32,
      marginRight: 12,
      width: 32,
    },
    passkeyIcon: {
      marginLeft: 6,
    },
    serviceName: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '600',
      marginBottom: 4,
    },
    serviceNameRow: {
      alignItems: 'center',
      flexDirection: 'row',
    },
  });

  return (
    <ContextMenu
      title={t('credentials.contextMenu.title')}
      actions={getMenuActions()}
      onPress={handleContextMenuAction}
      previewBackgroundColor={colors.accentBackground}
    >
      <TouchableOpacity
        style={styles.credentialCard}
        onPress={() => {
          Keyboard.dismiss();
          router.push(`/(tabs)/credentials/${credential.Id}`);
        }}
        onLongPress={() => {
          // Ignore long press to prevent context menu long press from triggering the credential card press.
        }}
        activeOpacity={0.7}
      >
        <View style={styles.credentialContent}>
          <CredentialIcon logo={credential.Logo} style={styles.logo} />
          <View style={styles.credentialInfo}>
            <View style={styles.serviceNameRow}>
              <Text style={styles.serviceName}>
                {getCredentialServiceName(credential)}
              </Text>
              {credential.HasPasskey && (
                <MaterialIcons
                  name="vpn-key"
                  size={14}
                  color={colors.textMuted}
                  style={styles.passkeyIcon}
                />
              )}
              {credential.HasAttachment && (
                <MaterialIcons
                  name="attach-file"
                  size={14}
                  color={colors.textMuted}
                  style={styles.passkeyIcon}
                />
              )}
            </View>
            <Text style={styles.credentialText}>
              {getCredentialDisplayText(credential)}
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    </ContextMenu>
  );
}
