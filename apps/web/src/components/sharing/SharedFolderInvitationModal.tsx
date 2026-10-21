import { familySharingText, isInviterVerified } from '@aliasvault/client/sharing/FamilySharingView';
import { SharingService } from '@aliasvault/client/sharing/SharingService';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AlertMessageError from '@/components/alerts/AlertMessageError';
import Button from '@/components/shared/Button';
import FormModal from '@/components/shared/FormModal';
import InputTextField from '@/components/shared/InputTextField';
import { useWebApi } from '@/context/WebApiContext';
import { sharingFailureMessage, unwrapSharingResult } from '@/utils/SharingErrors';
import { vaultStore } from '@/vault/VaultStore';

import type { ReceivedManifestInvitation } from '@aliasvault/models/webapi';

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
      const result = await vaultStore.acceptSharedManifestInvitation(invitation.id, askCode ? code.trim() : undefined);
      if (result.apiErrorCode === 'INVITER_NOT_VERIFIED') {
        setAskCode(true);
      }
      unwrapSharingResult(result, familySharingText.errors.invitationGone, t);
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
    <>
      <Button id="accept-invitation" isDisabled={busy || (askCode && code.trim().length === 0)} onClick={() => void accept()}>{familySharingText.accept}</Button>
      {!askCode && <Button color="secondary" isDisabled={busy} onClick={() => void decline()}>{familySharingText.decline}</Button>}
      {askCode && <Button color="secondary" isDisabled={busy} onClick={() => setAskCode(false)}>{t('common.back')}</Button>}
    </>
  );

  return (
    <FormModal
      isOpen
      title={askCode ? familySharingText.inviterCodeTitle(invitation.inviterUsername) : familySharingText.sharedWithYou(invitation.inviterUsername, folderName)}
      footerContent={footer}
      onClose={onClose}
      onConfirm={() => void accept()}
    >
      <div className="space-y-3">
        {!askCode && (
          <>
            <p className="text-sm text-gray-600 dark:text-gray-300">{familySharingText.sharedWithYouHint}</p>
            <p className="text-sm text-gray-500 dark:text-gray-400">{isInviterVerified(invitation) ? familySharingText.invitedByVerified(invitation.inviterUsername) : familySharingText.invitedBy(invitation.inviterUsername)}</p>
          </>
        )}
        {askCode && (
          <>
            <p className="text-sm text-gray-600 dark:text-gray-300">{familySharingText.inviterCodeExplanation(invitation.inviterUsername)}</p>
            <InputTextField id="inviter-code" value={code} onValueChange={setCode} placeholder={familySharingText.codePlaceholder} autoFocus />
          </>
        )}
        {error && <AlertMessageError message={error} hasTopMargin={false} />}
      </div>
    </FormModal>
  );
};

export default SharedFolderInvitationModal;
