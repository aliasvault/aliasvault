import { apiErrorCodeOf } from '@aliasvault/client/api/errors/ApiRequestError';
import { MasterPasswordService } from '@aliasvault/client/auth/MasterPasswordService';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import ConfirmDeleteModal from '@/entrypoints/popup/components/Dialogs/ConfirmDeleteModal';
import ConfirmPasswordModal from '@/entrypoints/popup/components/Dialogs/ConfirmPasswordModal';
import { useLoading } from '@/entrypoints/popup/context/LoadingContext';
import { sharingFailureMessage } from '@/entrypoints/popup/utils/SharingErrors';

import type { SrpChallengeResponder } from '@aliasvault/client/sharing/SharingService';

/**
 * An action the user confirms first and the server then confirms with the master password.
 */
export type PasswordConfirmedAction = {
  title: string;
  /** The warning shown before the password is asked for. */
  confirmMessage: string;
  /** The text of both confirm buttons. */
  confirmText: string;
  /** The text next to the password field. */
  description: string;
  failureMessage: string;
  /** Run the action, answering the server's SRP challenge with the entered password. */
  perform: (answerChallenge: SrpChallengeResponder) => Promise<void>;
  /** What follows once the action succeeded. */
  onDone: () => Promise<void> | void;
};

/**
 * A warning followed by a master password prompt for actions the server confirms with it. A wrong password keeps the prompt open.
 * @returns `askPassword` to start the confirmation of an action, and the dialogs to render.
 */
export function usePasswordConfirmedAction(): { askPassword: (action: PasswordConfirmedAction) => void; passwordModal: React.ReactNode } {
  const { t } = useTranslation();
  const { showLoading, hideLoading } = useLoading();
  const [pending, setPending] = useState<{ action: PasswordConfirmedAction; stage: 'confirm' | 'password' } | null>(null);

  /**
   * Start the confirmation of an action.
   * @param action - the action to run once confirmed.
   */
  const askPassword = (action: PasswordConfirmedAction): void => setPending({ action, stage: 'confirm' });

  /**
   * Run the pending action with the entered master password; a thrown error keeps the prompt open with its message.
   * @param password - the entered master password.
   */
  const run = async (password: string): Promise<void> => {
    const action = pending?.action;
    if (!action) {
      return;
    }

    showLoading();
    try {
      await action.perform(async challenge => (await MasterPasswordService.answerSrpChallenge(challenge, password)).proof);
    } catch (actionError) {
      throw new Error(apiErrorCodeOf(actionError) === 'PASSWORD_MISMATCH' ? t('common.errors.wrongPassword') : sharingFailureMessage(actionError, action.failureMessage));
    } finally {
      hideLoading();
    }

    setPending(null);
    await action.onDone();
  };

  const passwordModal = (
    <>
      <ConfirmDeleteModal
        isOpen={pending?.stage === 'confirm'}
        onClose={() => setPending(null)}
        onConfirm={() => setPending(previous => (previous ? { ...previous, stage: 'password' } : previous))}
        title={pending?.action.title ?? ''}
        message={pending?.action.confirmMessage ?? ''}
        confirmText={pending?.action.confirmText ?? ''}
      />
      <ConfirmPasswordModal
        isOpen={pending?.stage === 'password'}
        onClose={() => setPending(null)}
        onConfirm={run}
        title={pending?.action.title ?? ''}
        message={pending?.action.description ?? ''}
        confirmText={pending?.action.confirmText ?? ''}
      />
    </>
  );

  return { askPassword, passwordModal };
}
