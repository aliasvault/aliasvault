import { sharingText, isInviterVerified } from '@aliasvault/client/sharing/SharingView';
import { SharingService } from '@aliasvault/client/sharing/SharingService';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { sharingFailureMessage, unwrapSharingResult } from '@/utils/SharingErrors';

import { useColors } from '@/hooks/useColorScheme';

import { ModalWrapper } from '@/components/common/ModalWrapper';
import { useWebApi } from '@/context/WebApiContext';
import NativeVaultManager from '@/specs/NativeVaultManager';

import type { ReceivedManifestInvitation } from '@aliasvault/models/webapi';

interface ISharedFolderInvitationModalProps {
  invitation: ReceivedManifestInvitation | null;
  /** The name of the shared folder, as the invitation carries it. */
  folderName: string;
  /** Called once the invitation was accepted or declined. */
  onDone: (accepted: boolean) => Promise<void>;
  onClose: () => void;
}

/**
 * An invitation to a shared folder: accept or decline it. Accepting from an inviter this account has not verified yet
 * first asks for their account fingerprint.
 */
export const SharedFolderInvitationModal: React.FC<ISharedFolderInvitationModalProps> = ({ invitation, folderName, onDone, onClose }) => {
  const { t } = useTranslation();
  const colors = useColors();
  const webApi = useWebApi();
  const [askFingerprint, setAskCode] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset the dialog for each invitation
    setAskCode(false);
    setCode('');
    setError(null);
  }, [invitation?.id]);

  const styles = StyleSheet.create({
    bodyText: {
      color: colors.text,
      fontSize: 15,
    },
    buttonRow: {
      flexDirection: 'row',
      gap: 12,
      marginTop: 20,
    },
    codeInput: {
      backgroundColor: colors.modalSurfaceRaised,
      borderColor: colors.accentBorder,
      borderRadius: 8,
      borderWidth: 1,
      color: colors.text,
      fontSize: 16,
      marginTop: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    disabled: {
      opacity: 0.5,
    },
    errorText: {
      color: colors.destructive,
      fontSize: 14,
      marginTop: 8,
    },
    modalButton: {
      alignItems: 'center',
      borderColor: colors.accentBorder,
      borderRadius: 8,
      borderWidth: 1,
      flex: 1,
      paddingVertical: 12,
    },
    modalButtonPrimary: {
      backgroundColor: colors.tint,
      borderWidth: 0,
    },
    modalButtonPrimaryText: {
      color: colors.white,
      fontSize: 16,
      fontWeight: '600',
    },
    modalButtonText: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '500',
    },
    mutedText: {
      color: colors.textMuted,
      fontSize: 14,
      marginTop: 8,
    },
  });

  if (!invitation) {
    return null;
  }

  /**
   * Accept, with the inviter's account fingerprint when it was asked for; an engine that holds no certification of the inviter asks for it.
   */
  const accept = async (): Promise<void> => {
    if (!askFingerprint && !isInviterVerified(invitation)) {
      setAskCode(true);
      return;
    }
    if (askFingerprint && code.trim().length === 0) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const result = await NativeVaultManager.runSharingOperation('acceptSharedManifestInvitation', JSON.stringify({ invitationId: invitation.id, accountFingerprint: askFingerprint ? code.trim() : undefined }));
      if (result.apiErrorCode === 'INVITER_NOT_VERIFIED') {
        setAskCode(true);
      }
      unwrapSharingResult(result, sharingText.errors.invitationGone);
      await onDone(true);
    } catch (acceptError) {
      setError(sharingFailureMessage(acceptError, sharingText.errors.invitationGone));
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
      setError(sharingFailureMessage(declineError, sharingText.errors.invitationGone));
    } finally {
      setBusy(false);
    }
  };

  const canAccept = !busy && !(askFingerprint && code.trim().length === 0);

  return (
    <ModalWrapper
      isOpen
      onClose={onClose}
      isSubmitting={busy}
      title={askFingerprint ? sharingText.inviterFingerprintTitle(invitation.inviterUsername) : sharingText.sharedWithYou(invitation.inviterUsername, folderName)}
      keyboardAvoiding
      showHeaderBorder={false}
      showFooterBorder={false}
    >
      {!askFingerprint && (
        <>
          <Text style={styles.bodyText}>{sharingText.sharedWithYouHint}</Text>
          <Text style={styles.mutedText}>{isInviterVerified(invitation) ? sharingText.invitedByVerified(invitation.inviterUsername) : sharingText.invitedBy(invitation.inviterUsername)}</Text>
        </>
      )}
      {askFingerprint && (
        <>
          <Text style={styles.bodyText}>{sharingText.inviterFingerprintExplanation(invitation.inviterUsername)}</Text>
          <TextInput
            style={styles.codeInput}
            value={code}
            onChangeText={setCode}
            placeholder={sharingText.fingerprintPlaceholder}
            placeholderTextColor={colors.textMuted}
            keyboardType="number-pad"
            autoCorrect={false}
            autoFocus
            editable={!busy}
            onSubmitEditing={() => void accept()}
          />
        </>
      )}
      {error && <Text style={styles.errorText}>{error}</Text>}
      <View style={styles.buttonRow}>
        <TouchableOpacity style={[styles.modalButton, busy && styles.disabled]} disabled={busy} onPress={() => (askFingerprint ? setAskCode(false) : void decline())}>
          <Text style={styles.modalButtonText}>{askFingerprint ? t('common.back') : sharingText.decline}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.modalButton, styles.modalButtonPrimary, !canAccept && styles.disabled]} disabled={!canAccept} onPress={() => void accept()}>
          {busy ? <ActivityIndicator color={colors.white} size="small" /> : <Text style={styles.modalButtonPrimaryText}>{sharingText.accept}</Text>}
        </TouchableOpacity>
      </View>
    </ModalWrapper>
  );
};

export default SharedFolderInvitationModal;
