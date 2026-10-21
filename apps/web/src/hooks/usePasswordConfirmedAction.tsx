import { apiErrorCodeOf } from '@aliasvault/client/api/errors/ApiRequestError';
import { MasterPasswordService } from '@aliasvault/client/auth/MasterPasswordService';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import PasswordConfirmationModal from '@/components/shared/PasswordConfirmationModal';
import { useLoading } from '@/context/LoadingContext';
import { sharingFailureMessage } from '@/utils/SharingErrors';

import type { SrpChallengeResponder } from '@aliasvault/client/sharing/SharingService';

/**
 * An action the server confirms with the master password.
 */
export type PasswordConfirmedAction = {
  title: string;
  description: string;
  failureMessage: string;
  /** Run the action, answering the server's SRP challenge with the entered password. */
  perform: (answerChallenge: SrpChallengeResponder) => Promise<void>;
  /** What follows once the action succeeded. */
  onDone: () => Promise<void> | void;
};

/**
 * A master password prompt for actions the server confirms with it. A wrong password keeps the prompt open.
 * @returns `askPassword` to open the prompt for an action, and the prompt element to render.
 */
export function usePasswordConfirmedAction(): { askPassword: (action: PasswordConfirmedAction) => void; passwordModal: React.ReactNode } {
  const { t } = useTranslation();
  const { showLoading, hideLoading } = useLoading();
  const [pending, setPending] = useState<PasswordConfirmedAction | null>(null);
  const [error, setError] = useState('');

  /**
   * Open the prompt for an action.
   * @param action - the action to run once the password is entered.
   */
  const askPassword = (action: PasswordConfirmedAction): void => {
    setError('');
    setPending(action);
  };

  /**
   * Run the pending action with the entered master password.
   * @param password - the entered master password.
   */
  const run = async (password: string): Promise<void> => {
    const action = pending;
    if (!action) {
      return;
    }

    showLoading();
    try {
      await action.perform(async challenge => (await MasterPasswordService.answerSrpChallenge(challenge, password)).proof);
    } catch (actionError) {
      setError(apiErrorCodeOf(actionError) === 'PASSWORD_MISMATCH' ? t('common.errors.wrongPassword') : sharingFailureMessage(actionError, action.failureMessage));
      return;
    } finally {
      hideLoading();
    }

    setPending(null);
    await action.onDone();
  };

  const passwordModal = (
    <PasswordConfirmationModal
      isOpen={pending !== null}
      title={pending?.title ?? ''}
      description={pending?.description ?? ''}
      errorMessage={error}
      onPasswordSubmitted={password => void run(password)}
      onClose={() => setPending(null)}
    />
  );

  return { askPassword, passwordModal };
}
