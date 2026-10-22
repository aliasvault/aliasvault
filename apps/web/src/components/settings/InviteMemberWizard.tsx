import { sharingText, splitAround } from '@aliasvault/client/sharing/SharingView';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AlertMessageError from '@/components/alerts/AlertMessageError';
import AccountFingerprint from '@/components/settings/AccountFingerprint';
import Button from '@/components/shared/Button';
import FormModal from '@/components/shared/FormModal';
import Icon from '@/components/shared/Icon';
import InlineSpinner from '@/components/shared/InlineSpinner';
import InputTextField from '@/components/shared/InputTextField';

/**
 * `text` with `value` in bold.
 * @param text - the full text.
 * @param value - the part to emphasize.
 */
const emphasized = (text: string, value: string): React.ReactNode => {
  const [before, bold, after] = splitAround(text, value);
  return <>{before}<strong className="font-semibold text-gray-900 dark:text-white">{bold}</strong>{after}</>;
};

/**
 * The account an account fingerprint belongs to.
 */
export type AccountLookupResult = {
  username: string;
};

/**
 * Somebody verified before, who can be invited without their account fingerprint.
 */
export type KnownPerson = {
  userId: string;
  username: string;
  /** Why they cannot be invited yet, or null when they can. */
  problem: string | null;
};

type InviteMemberWizardProps = {
  isOpen: boolean;
  /** This account's own fingerprint, which the invitee needs to accept. */
  ownFingerprint: string | null;
  /** Find the account behind an account fingerprint; throws an error with the message to show. */
  onLookup: (code: string) => Promise<AccountLookupResult>;
  /** Invite the account behind an account fingerprint; throws an error with the message to show. */
  onInvite: (code: string) => Promise<void>;
  /** The people verified before who are not in the folder yet, offered before the fingerprint field. */
  people?: KnownPerson[];
  /** Invite somebody verified before; throws an error with the message to show. */
  onInvitePerson?: (userId: string) => Promise<void>;
  /** The folder the invitation is for. */
  folderName: string;
  /** Whether inviting turns a personal folder into a shared one. */
  sharesFolder?: boolean;
  onClose: () => void;
};

const STEP_COUNT = 3;

/** Seconds the close button of the last step stays disabled, so the instructions get read. */
const CLOSE_DELAY_SECONDS = 3;

/**
 * Three step wizard that picks somebody verified before or takes a new person's account fingerprint, confirms who gets invited, and hands
 * out this account's own fingerprint for them to accept with.
 */
const InviteMemberWizard: React.FC<InviteMemberWizardProps> = ({ isOpen, ownFingerprint, onLookup, onInvite, people = [], onInvitePerson, folderName, sharesFolder = false, onClose }) => {
  const { t } = useTranslation();
  const [step, setStep] = useState(1);
  const [code, setCode] = useState('');
  const [account, setAccount] = useState<AccountLookupResult | null>(null);
  /** The person verified before who was picked instead of entering a fingerprint. */
  const [selected, setSelected] = useState<KnownPerson | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [closeCountdown, setCloseCountdown] = useState(0);

  useEffect(() => {
    if (isOpen) {
      setStep(1);
      setCode('');
      setAccount(null);
      setSelected(null);
      setError(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (closeCountdown <= 0) {
      return undefined;
    }

    const timer = setTimeout(() => setCloseCountdown(seconds => seconds - 1), 1000);
    return (): void => clearTimeout(timer);
  }, [closeCountdown]);

  const trimmedCode = code.trim();

  /**
   * Run one step's action, showing its error in the wizard.
   * @param action - the action to run.
   */
  const runStep = async (action: () => Promise<void>): Promise<void> => {
    setIsBusy(true);
    setError(null);
    try {
      await action();
    } catch (stepError) {
      setError(stepError instanceof Error ? stepError.message : t('common.errors.unknownErrorTryAgain'));
    } finally {
      setIsBusy(false);
    }
  };

  /**
   * Ask to confirm the person picked, or look the fingerprint up first and ask to confirm who it belongs to.
   */
  const lookup = (): Promise<void> => runStep(async () => {
    setAccount(selected ? { username: selected.username } : await onLookup(trimmedCode));
    setStep(2);
  });

  /**
   * Invite the person picked or the account behind the account fingerprint, then show this account's own fingerprint.
   */
  const invite = (): Promise<void> => runStep(async () => {
    if (selected && onInvitePerson) {
      await onInvitePerson(selected.userId);
    } else {
      await onInvite(trimmedCode);
    }
    setCloseCountdown(CLOSE_DELAY_SECONDS);
    setStep(3);
  });

  const canClose = !isBusy && (step !== 3 || closeCountdown === 0);

  /**
   * The primary action of the current step, also run on Enter.
   */
  const confirm = (): void => {
    if (isBusy) {
      return;
    }
    if (step === 1 && (selected !== null || trimmedCode.length > 0)) {
      void lookup();
    } else if (step === 2) {
      void invite();
    } else if (step === 3 && canClose) {
      onClose();
    }
  };

  /**
   * Close, unless a step is running or the last step still counts down.
   */
  const close = (): void => {
    if (canClose) {
      onClose();
    }
  };

  const footer = (
    <>
      {step === 1 && <Button id="invite-wizard-next" isDisabled={isBusy || (selected === null && trimmedCode.length === 0)} onClick={confirm}>{t('common.next')}</Button>}
      {step === 2 && <Button id="invite-wizard-confirm" isDisabled={isBusy} onClick={confirm}>{sharingText.invite}</Button>}
      {step === 3 && <Button id="invite-wizard-close" isDisabled={!canClose} onClick={close}>{closeCountdown > 0 ? sharingText.closeCountdown(closeCountdown) : t('common.close')}</Button>}
      {step === 1 && <Button color="secondary" isDisabled={isBusy} onClick={close}>{t('common.cancel')}</Button>}
      {step === 2 && <Button color="secondary" isDisabled={isBusy} onClick={() => setStep(1)}>{t('common.back')}</Button>}
    </>
  );

  return (
    <FormModal isOpen={isOpen} title={sharingText.invitePeople} maxWidth="xl" closeOnOverlayClick={false} closeOnEscape={canClose} footerContent={footer} onClose={close} onConfirm={confirm}>
      {/* Progress through the three steps. */}
      <div className="mb-5">
        <div className="flex gap-2" aria-hidden="true">
          {Array.from({ length: STEP_COUNT }, (_, index) => (
            <div key={index} className={`h-1.5 flex-1 rounded-full ${index < step ? 'bg-primary-500' : 'bg-gray-200 dark:bg-gray-700'}`} />
          ))}
        </div>
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{sharingText.wizardStep(step, STEP_COUNT)}</p>
      </div>

      {/* While a step works (looking the fingerprint up, or sharing the folder and sending the invitation) its content makes way for a spinner. */}
      {isBusy && <InlineSpinner text={step === 2 && sharesFolder ? sharingText.wizardCreating : t('common.loading')} />}

      {step === 1 && !isBusy && (
        <div className="space-y-5">
          {/* Somebody verified before needs no fingerprint; picking them and entering one exclude each other. */}
          {people.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-base font-medium text-gray-900 dark:text-white">{sharingText.inviteWizardChooseTitle}</h4>
              <ul className="space-y-2">
                {people.map(person => {
                  const isSelected = selected?.userId === person.userId;
                  return (
                    <li key={person.userId}>
                      <button
                        type="button"
                        data-person-option={person.username}
                        disabled={person.problem !== null}
                        title={person.problem ?? undefined}
                        onClick={() => {
                          setSelected(isSelected ? null : person);
                          setCode('');
                        }}
                        className={`flex w-full items-center gap-3 rounded-lg border px-4 py-2.5 text-left text-sm transition-colors disabled:opacity-50 ${isSelected ? 'border-primary-500 bg-primary-50 text-gray-900 dark:bg-primary-500/10 dark:text-white' : 'border-gray-200 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-700/50'}`}
                      >
                        <Icon name={isSelected ? 'check-circle' : 'users'} className={`h-5 w-5 shrink-0 ${isSelected ? 'text-primary-500' : 'text-gray-400'}`} />
                        <span className="truncate">{person.username}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <div className="space-y-3">
            <h4 className="text-base font-medium text-gray-900 dark:text-white">{people.length > 0 ? sharingText.inviteWizardNewFingerprintTitle : sharingText.inviteWizardFingerprintTitle}</h4>
            <p className="text-sm text-gray-500 dark:text-gray-400">{sharingText.inviteWizardFingerprintHint}</p>
            <InputTextField
              id="invite-wizard-fingerprint"
              value={code}
              onValueChange={value => {
                setCode(value);
                setSelected(null);
              }}
              placeholder={sharingText.fingerprintPlaceholder}
              autoFocus={people.length === 0}
            />
          </div>
        </div>
      )}

      {step === 2 && account && !isBusy && (
        <div className="space-y-3">
          <h4 className="text-base font-medium text-gray-900 dark:text-white">{sharingText.inviteWizardConfirmTitle}</h4>
          <p className="text-sm text-gray-600 dark:text-gray-300">{emphasized(sharesFolder ? sharingText.inviteWizardConfirmShare(account.username, folderName) : sharingText.inviteWizardConfirmFolder(account.username, folderName), account.username)}</p>
        </div>
      )}

      {step === 3 && account && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Icon name="check-circle" className="w-6 h-6 shrink-0 text-green-500" />
            <h4 className="text-base font-medium text-gray-900 dark:text-white">{emphasized(sharingText.inviteWizardInvited(account.username), account.username)}</h4>
          </div>
          {/* What the admin still has to do: the invitee types this fingerprint to accept. */}
          <div className="space-y-3 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
            <h5 className="text-sm font-semibold text-gray-900 dark:text-white">{sharingText.inviteWizardNextStep}</h5>
            <p className="text-sm text-gray-600 dark:text-gray-300">{emphasized(sharingText.inviteWizardShareHint(account.username), account.username)}</p>
            {ownFingerprint && <AccountFingerprint code={ownFingerprint} />}
            <p className="text-xs text-gray-500 dark:text-gray-400">{sharingText.inviteWizardShareNotSecret}</p>
          </div>
        </div>
      )}

      {error && <AlertMessageError message={error} />}
    </FormModal>
  );
};

export default InviteMemberWizard;
