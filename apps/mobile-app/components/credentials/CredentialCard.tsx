import { StyleSheet, View, Text, TouchableOpacity, Keyboard, Platform, Alert } from 'react-native';
import { router } from 'expo-router';
import ContextMenu, { OnPressMenuItemEvent } from 'react-native-context-menu-view';
import * as Clipboard from 'expo-clipboard';
import Toast from 'react-native-toast-message';

import { CredentialIcon } from '@/components/credentials/CredentialIcon';
import { useColors } from '@/hooks/useColorScheme';
import { Credential } from '@/utils/types/Credential';

type CredentialCardProps = {
  credential: Credential;
  onCredentialDelete?: (credentialId: string) => Promise<void>;
};

/**
 * Credential card component.
 */
export function CredentialCard({ credential, onCredentialDelete }: CredentialCardProps) : React.ReactNode {
  const colors = useColors();

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
   * Handles the context menu action when an item is selected.
   * @param event - The event object containing the selected action details
   */
  const handleContextMenuAction = (event: OnPressMenuItemEvent): void => {
    const { name } = event.nativeEvent;

    switch (name) {
      case 'Edit':
        Keyboard.dismiss();
        router.push({
          pathname: '/(tabs)/credentials/add-edit',
          params: { id: credential.Id }
        });
        break;
      case 'Delete':
        Keyboard.dismiss();
        Alert.alert(
          "Delete Credential",
          "Are you sure you want to delete this credential? This action cannot be undone.",
          [
            {
              text: "Cancel",
              style: "cancel"
            },
            {
              text: "Delete",
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
      case 'Copy Username':
        if (credential.Username) {
          Clipboard.setStringAsync(credential.Username);
          if (Platform.OS === 'ios') {
            Toast.show({
              type: 'success',
              text1: 'Username copied to clipboard',
              position: 'bottom',
            });
          }
        }
        break;
      case 'Copy Email':
        if (credential.Alias?.Email) {
          Clipboard.setStringAsync(credential.Alias.Email);
          if (Platform.OS === 'ios') {
            Toast.show({
              type: 'success',
              text1: 'Email copied to clipboard',
              position: 'bottom',
            });
          }
        }
        break;
      case 'Copy Password':
        if (credential.Password) {
          Clipboard.setStringAsync(credential.Password);
          if (Platform.OS === 'ios') {
            Toast.show({
              type: 'success',
              text1: 'Password copied to clipboard',
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
        title: 'Edit',
        systemIcon: Platform.select({
          ios: 'pencil',
          android: 'baseline_edit',
        }),
      },
      {
        title: 'Delete',
        systemIcon: Platform.select({
          ios: 'trash',
          android: 'baseline_delete',
        }),
        destructive: true,
      },
    ];

    if (credential.Username) {
      actions.push({
        title: 'Copy Username',
        systemIcon: Platform.select({
          ios: 'person',
          android: 'baseline_person',
        }),
      });
    }

    if (credential.Alias?.Email) {
      actions.push({
        title: 'Copy Email',
        systemIcon: Platform.select({
          ios: 'envelope',
          android: 'baseline_email',
        }),
      });
    }

    if (credential.Password) {
      actions.push({
        title: 'Copy Password',
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
    serviceName: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '600',
      marginBottom: 4,
    },
  });

  return (
    <ContextMenu
      title="Credential Options"
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
            <Text style={styles.serviceName}>
              {getCredentialServiceName(credential)}
            </Text>
            <Text style={styles.credentialText}>
              {getCredentialDisplayText(credential)}
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    </ContextMenu>
  );
}
