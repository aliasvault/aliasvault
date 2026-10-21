import { familySharingText, isInviterVerified } from '@aliasvault/client/sharing/FamilySharingView';
import { SharingService } from '@aliasvault/client/sharing/SharingService';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import ModalWrapper from '@/entrypoints/popup/components/Dialogs/ModalWrapper';
import { useWebApi } from '@/entrypoints/popup/context/WebApiContext';
import { sharingFailureMessage, unwrapSharingResult } from '@/entrypoints/popup/utils/SharingErrors';

import { sendMessage } from '@/utils/messaging/ExtensionMessaging';

import type { ReceivedManifestInvitation } from '@aliasvault/models/webapi';

const INPUT_CLASS = 'w-full p-2 text-sm border dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500';
const PRIMARY_BUTTON_CLASS = 'px-3 py-1.5 text-sm rounded-md bg-primary-500 hover:bg-primary-600 disabled:opacity-50 text-white';
const SECONDARY_BUTTON_CLASS = 'px-3 py-1.5 text-sm rounded-md bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 text-gray-700 dark:text-gray-300';

type SharedFolderInvitationModalProps = {
  invitation: ReceivedManifestInvitation | null;
  folderName: string;
  onDone: (accepted: boolean) => Promise<void>;
  onClose: () => void;
};

/**
 * An invitation to a shared folder: accept or decline it. Accepting from an inviter this account has not verified yet
 * first asks for their code.
 */
const SharedFolderInvitationModal: React.FC<SharedFolderInvitationModalProps> = ({ invitation, folderName, onDone, onClose }) => {
  const { t } = useTranslation();
  const webApi = useWebApi();
  const [askCode, setAskCode] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setAskCode(false);
    setCode('');
    setError(null);
  }, [invitation?.id]);

  if (!invitation) {
    return null;
  }

  /**
   * Accept, with the inviter's code when it was asked for; an engine that holds no certification of the inviter asks for it.
   */
  const accept = async (): Promise<void> => {
    if (!askCode && !isInviterVerified(invitation)) {
      setAskCode(true);
      return;
    }
    if (askCode && code.trim().length === 0) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      // The background syncs after accepting, which pulls the shared folder.
      const result = await sendMessage('GROUP_ACCEPT_MANIFEST_INVITATION', { invitationId: invitation.id, identityCode: askCode ? code.trim() : undefined });
      if (result.apiErrorCode === 'INVITER_NOT_VERIFIED') {
        setAskCode(true);
      }
      unwrapSharingResult(result);
      await onDone(true);
    } catch (acceptError) {
      setError(sharingFailureMessage(acceptError, familySharingText.errors.invitationGone));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Decline the invitation.
   */
  const decline = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await SharingService.declineInvitation(webApi, invitation.id);
      await onDone(false);
    } catch (declineError) {
      setError(sharingFailureMessage(declineError, familySharingText.errors.invitationGone));
    } finally {
      setBusy(false);
    }
  };

  const footer = (
    <div className="flex justify-end gap-2">
      {!askCode && <button type="button" disabled={busy} onClick={() => void decline()} className={SECONDARY_BUTTON_CLASS}>{familySharingText.decline}</button>}
      {askCode && <button type="button" disabled={busy} onClick={() => setAskCode(false)} className={SECONDARY_BUTTON_CLASS}>{t('common.back')}</button>}
      <button id="accept-invitation" type="submit" form="shared-folder-invitation-form" disabled={busy || (askCode && code.trim().length === 0)} className={PRIMARY_BUTTON_CLASS}>{familySharingText.accept}</button>
    </div>
  );

  return (
    <ModalWrapper
      isOpen
      onClose={onClose}
      title={askCode ? familySharingText.inviterCodeTitle(invitation.inviterUsername) : familySharingText.sharedWithYou(invitation.inviterUsername, folderName)}
      footer={footer}
    >
      <form
        id="shared-folder-invitation-form"
        className="space-y-3"
        onSubmit={event => {
          event.preventDefault();
          void accept();
        }}
      >
        {!askCode && (
          <>
            <p className="text-sm text-gray-600 dark:text-gray-300">{familySharingText.sharedWithYouHint}</p>
            <p className="text-sm text-gray-500 dark:text-gray-400">{isInviterVerified(invitation) ? familySharingText.invitedByVerified(invitation.inviterUsername) : familySharingText.invitedBy(invitation.inviterUsername)}</p>
          </>
        )}
        {askCode && (
          <>
            <p className="text-sm text-gray-600 dark:text-gray-300">{familySharingText.inviterCodeExplanation(invitation.inviterUsername)}</p>
            <input id="inviter-code" type="text" className={INPUT_CLASS} value={code} onChange={event => setCode(event.target.value)} placeholder={familySharingText.codePlaceholder} autoFocus />
          </>
        )}
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      </form>
    </ModalWrapper>
  );
};

export default SharedFolderInvitationModal;
