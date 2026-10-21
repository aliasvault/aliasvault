import { familySharingText, splitAround } from '@aliasvault/client/sharing/FamilySharingView';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import ModalWrapper from '@/entrypoints/popup/components/Dialogs/ModalWrapper';
import Icon from '@/entrypoints/popup/components/Icons/Icon';
import InlineSpinner from '@/entrypoints/popup/components/InlineSpinner';
import FamilyCodeDisplay from '@/entrypoints/popup/components/Sharing/FamilyCodeDisplay';

/**
 * `text` with `value` in bold.
 * @param text - the full text.
 * @param value - the part to emphasize.
 */
const emphasized = (text: string, value: string): React.ReactNode => {
  const [before, bold, after] = splitAround(text, value);
  return <>{before}<strong className="font-semibold text-gray-900 dark:text-white">{bold}</strong>{after}</>;
};

/** The account a code belongs to. */
export type FamilyCodeAccount = { username: string };

/**
 * Somebody verified before, who can be invited without their code.
 */
export type KnownPerson = {
  userId: string;
  username: string;
  /** Why they cannot be invited yet, or null when they can. */
  problem: string | null;
};

type InviteMemberWizardProps = {
  isOpen: boolean;
  /** This account's own code, which the invitee needs to accept. */
  ownCode: string | null;
  /** The folder the invitation is for. */
  folderName: string;
  /** Whether inviting turns a personal folder into a shared one. */
  sharesFolder?: boolean;
  /** The people verified before who are not in the folder yet, offered before the code field. */
  people?: KnownPerson[];
  /** Find the account behind a code; throws an error with the message to show. */
  onLookup: (code: string) => Promise<FamilyCodeAccount>;
  /** Invite the account behind a code; throws an error with the message to show. */
  onInvite: (code: string) => Promise<void>;
  /** Invite somebody verified before; throws an error with the message to show. */
  onInvitePerson?: (userId: string) => Promise<void>;
  onClose: () => void;
};

const STEP_COUNT = 3;

/** Seconds the close button of the last step stays disabled, so the instructions get read. */
const CLOSE_DELAY_SECONDS = 3;

const INPUT_CLASS = 'w-full p-2 border dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500';
const PRIMARY_CLASS = 'px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50';
const SECONDARY_CLASS = 'px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50';

/**
 * Three step wizard that picks somebody verified before or takes a new person's code, confirms who gets invited, and hands
 * out this account's own code for them to accept with.
 */
const InviteMemberWizard: React.FC<InviteMemberWizardProps> = ({ isOpen, ownCode, folderName, sharesFolder = false, people = [], onLookup, onInvite, onInvitePerson, onClose }) => {
  const { t } = useTranslation();
  const [step, setStep] = useState(1);
  const [code, setCode] = useState('');
  const [account, setAccount] = useState<FamilyCodeAccount | null>(null);
  /** The person verified before who was picked instead of entering a code. */
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
      return;
    }
    const timer = setTimeout(() => setCloseCountdown(previous => previous - 1), 1000);
    return (): void => clearTimeout(timer);
  }, [closeCountdown]);

  const trimmedCode = code.trim();

  /**
   * Run one step's action, showing its error in the wizard.
   * @param action - the action.
   */
  const runStep = async (action: () => Promise<void>): Promise<void> => {
    setIsBusy(true);
    setError(null);
    try {
      await action();
    } catch (stepError) {
      setError(stepError instanceof Error && stepError.message.length > 0 ? stepError.message : t('common.errors.unknownErrorTryAgain'));
    } finally {
      setIsBusy(false);
    }
  };

  /**
   * Ask to confirm the person picked, or look the code up first and ask to confirm who it belongs to.
   */
  const lookup = (): Promise<void> => runStep(async () => {
    setAccount(selected ? { username: selected.username } : await onLookup(trimmedCode));
    setStep(2);
  });

  /**
   * Invite the person picked or the account behind the code, then show this account's own code.
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

  const canClose = !isBusy && (step !== 3 || closeCountdown <= 0);

  /**
   * Close, unless a step is running or the last step still counts down.
   */
  const close = (): void => {
    if (canClose) {
      onClose();
    }
  };

  const footer = (
    <div className="flex justify-end gap-3">
      {step === 1 && <button type="button" onClick={close} disabled={isBusy} className={SECONDARY_CLASS}>{t('common.cancel')}</button>}
      {step === 1 && <button id="invite-wizard-next" type="submit" form="invite-member-form" disabled={isBusy || (selected === null && trimmedCode.length === 0)} className={PRIMARY_CLASS}>{t('common.next')}</button>}
      {step === 2 && <button type="button" onClick={() => setStep(1)} disabled={isBusy} className={SECONDARY_CLASS}>{t('common.back')}</button>}
      {step === 2 && <button id="invite-wizard-confirm" type="button" onClick={() => void invite()} disabled={isBusy} className={PRIMARY_CLASS}>{familySharingText.invite}</button>}
      {step === 3 && <button id="invite-wizard-close" type="button" onClick={close} disabled={!canClose} className={PRIMARY_CLASS}>{closeCountdown > 0 ? familySharingText.closeCountdown(closeCountdown) : t('common.close')}</button>}
    </div>
  );

  return (
    <ModalWrapper isOpen={isOpen} onClose={close} title={familySharingText.invitePeople} showCloseButton={canClose} footer={footer}>
      {/* Progress through the three steps. */}
      <div className="mb-4">
        <div className="flex gap-2" aria-hidden="true">
          {Array.from({ length: STEP_COUNT }, (_, index) => (
            <div key={index} className={`h-1.5 flex-1 rounded-full ${index < step ? 'bg-primary-500' : 'bg-gray-200 dark:bg-gray-700'}`} />
          ))}
        </div>
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{familySharingText.wizardStep(step, STEP_COUNT)}</p>
      </div>

      {/* While a step works (looking the code up, or sharing the folder and sending the invitation) its content makes way for a spinner. */}
      {isBusy && <InlineSpinner text={step === 2 && sharesFolder ? familySharingText.wizardCreating : t('common.loading')} />}

      {step === 1 && !isBusy && (
        <form
          id="invite-member-form"
          className="space-y-4"
          onSubmit={event => {
            event.preventDefault();
            if (!isBusy && (selected !== null || trimmedCode.length > 0)) {
              void lookup();
            }
          }}
        >
          {/* Somebody verified before needs no code; picking them and entering a code exclude each other. */}
          {people.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-base font-medium text-gray-900 dark:text-white">{familySharingText.inviteWizardChooseTitle}</h4>
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
                        className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm transition-colors disabled:opacity-50 ${isSelected ? 'border-primary-500 bg-primary-50 text-gray-900 dark:bg-primary-500/10 dark:text-white' : 'border-gray-200 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-700/50'}`}
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
            <h4 className="text-base font-medium text-gray-900 dark:text-white">{people.length > 0 ? familySharingText.inviteWizardNewCodeTitle : familySharingText.inviteWizardCodeTitle}</h4>
            <p className="text-sm text-gray-500 dark:text-gray-400">{familySharingText.inviteWizardCodeHint}</p>
            <input
              id="invite-wizard-code"
              type="text"
              value={code}
              onChange={event => {
                setCode(event.target.value);
                setSelected(null);
              }}
              placeholder={familySharingText.codePlaceholder}
              autoFocus={people.length === 0}
              className={INPUT_CLASS}
            />
          </div>
        </form>
      )}

      {step === 2 && account && !isBusy && (
        <div className="space-y-3">
          <h4 className="text-base font-medium text-gray-900 dark:text-white">{familySharingText.inviteWizardConfirmTitle}</h4>
          <p className="text-sm text-gray-600 dark:text-gray-300">{emphasized(sharesFolder ? familySharingText.inviteWizardConfirmShare(account.username, folderName) : familySharingText.inviteWizardConfirmFolder(account.username, folderName), account.username)}</p>
        </div>
      )}

      {step === 3 && account && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Icon name="check-circle" className="w-6 h-6 shrink-0 text-green-600 dark:text-green-400" />
            <h4 className="text-base font-medium text-gray-900 dark:text-white">{emphasized(familySharingText.inviteWizardInvited(account.username), account.username)}</h4>
          </div>
          {/* What is left to do: the invitee types this code to accept. */}
          <div className="space-y-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
            <h5 className="text-sm font-semibold text-gray-900 dark:text-white">{familySharingText.inviteWizardNextStep}</h5>
            <p className="text-sm text-gray-600 dark:text-gray-300">{emphasized(familySharingText.inviteWizardShareHint(account.username), account.username)}</p>
            {ownCode && <FamilyCodeDisplay code={ownCode} />}
            <p className="text-xs text-gray-500 dark:text-gray-400">{familySharingText.inviteWizardShareNotSecret}</p>
          </div>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
    </ModalWrapper>
  );
};

export default InviteMemberWizard;
