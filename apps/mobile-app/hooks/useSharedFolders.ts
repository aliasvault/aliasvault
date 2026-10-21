import { sharingView, type SharedFolder } from '@aliasvault/client/sharing/FamilySharingView';
import { SharingService } from '@aliasvault/client/sharing/SharingService';
import { CapabilityKeys } from '@aliasvault/models/webapi';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';

import emitter from '@/utils/EventEmitter';

import { useCapabilities } from '@/context/CapabilityContext';
import { useWebApi } from '@/context/WebApiContext';
import NativeVaultManager from '@/specs/NativeVaultManager';

import type { GroupMemberInfo, ReceivedManifestInvitation } from '@aliasvault/models/webapi';

/**
 * What the vault shows of sharing: the shared folders with their people, the invitations waiting for an answer, the
 * people verified before and this account's own code.
 */
export type SharedFolders = {
  isEnabled: boolean;
  myUserId: string;
  folders: SharedFolder[];
  invitations: ReceivedManifestInvitation[];
  invitationNames: Record<string, string>;
  verifiedPeople: GroupMemberInfo[];
  ownCode: string | null;
  reload: () => Promise<void>;
};

/**
 * Load the sharing overview while vault sharing is enabled: when the screen gains focus, after every sync, and on request.
 */
export function useSharedFolders(): SharedFolders {
  const webApi = useWebApi();
  const isEnabled = useCapabilities()(CapabilityKeys.VaultSharing);
  const [view, setView] = useState<ReturnType<typeof sharingView>>(sharingView(null));
  const [invitationNames, setInvitationNames] = useState<Record<string, string>>({});
  const [ownCode, setOwnCode] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    if (!isEnabled) {
      return;
    }
    try {
      const overview = await SharingService.getOverview(webApi);
      setView(sharingView(overview));
      setInvitationNames(await SharingService.openInvitationNames(overview.receivedInvitations, encryptedName => NativeVaultManager.decryptInvitationName(encryptedName)));
      // The own code is derived natively from the signing private key, which only the native layer can open.
      setOwnCode(await NativeVaultManager.getSigningKeyFingerprint());
    } catch {
      // Offline or not reachable: the vault keeps showing what it already knew.
    }
  }, [isEnabled, webApi]);

  useFocusEffect(useCallback(() => {
    void reload();
  }, [reload]));

  useEffect(() => {
    const subscription = emitter.addListener('vaultSynced', () => void reload());
    return (): void => subscription.remove();
  }, [reload]);

  return { isEnabled, ...view, invitationNames, ownCode, reload };
}
