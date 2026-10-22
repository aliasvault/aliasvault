import { SharingService } from '@aliasvault/client/sharing/SharingService';
import { sharingView, type SharedFolder } from '@aliasvault/client/sharing/SharingView';
import { CapabilityKeys } from '@aliasvault/models/webapi';
import { useCallback, useEffect, useState } from 'react';

import { useCapabilities } from '@/context/CapabilityContext';
import { useWebApi } from '@/context/WebApiContext';

import type { GroupMemberInfo, ReceivedManifestInvitation } from '@aliasvault/models/webapi';

/**
 * What the vault shows of sharing: the shared folders with their people, the invitations waiting for an answer, the
 * people verified before and this account's own fingerprint.
 */
export type SharedFolders = {
  isEnabled: boolean;
  myUserId: string;
  folders: SharedFolder[];
  invitations: ReceivedManifestInvitation[];
  invitationNames: Record<string, string>;
  verifiedPeople: GroupMemberInfo[];
  ownFingerprint: string | null;
  reload: () => Promise<void>;
};

/**
 * Load the sharing overview while vault sharing is enabled, again whenever a sync reports a different number of open
 * invitations, and on request.
 */
export function useSharedFolders(): SharedFolders {
  const webApi = useWebApi();
  const isEnabled = useCapabilities()(CapabilityKeys.VaultSharing);
  const [view, setView] = useState<ReturnType<typeof sharingView>>(sharingView(null));
  const [invitationNames, setInvitationNames] = useState<Record<string, string>>({});
  const [ownFingerprint, setOwnFingerprint] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    if (!isEnabled) {
      return;
    }
    try {
      const overview = await SharingService.getOverview(webApi);
      setView(sharingView(overview));
      setInvitationNames(await SharingService.openInvitationNames(overview.receivedInvitations));
      setOwnFingerprint(await SharingService.ownAccountFingerprint());
    } catch {
      // Offline or not reachable: the vault keeps showing what it already knew.
    }
  }, [isEnabled, webApi]);

  useEffect(() => {
    void reload();
    return SharingService.watchPendingInvitationCount(() => void reload());
  }, [reload]);

  return { isEnabled, ...view, invitationNames, ownFingerprint, reload };
}
