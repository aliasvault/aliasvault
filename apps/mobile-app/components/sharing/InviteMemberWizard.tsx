import { familySharingText, splitAround } from '@aliasvault/client/sharing/FamilySharingView';
import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { useColors } from '@/hooks/useColorScheme';

import { ModalWrapper } from '@/components/common/ModalWrapper';
import { FamilyCode } from '@/components/sharing/FamilyCode';

/** The account a code belongs to. */
export type FamilyCodeAccount = { username: string };

/** Somebody verified before, who can be invited without their code. */
export type KnownPerson = {
  userId: string;
  username: string;
  /** Why they cannot be invited yet, or null when they can. */
  problem: string | null;
};

interface IInviteMemberWizardProps {
  isOpen: boolean;
  /** The account's own code, which the invitee needs to accept. */
  ownCode: string | null;
  /** The folder the invitation is for. */
  folderName: string;
  /** Whether inviting turns a personal folder into a shared one. */
  sharesFolder?: boolean;
  /** Find the account behind a code; throws an error with the message to show. */
  onLookup: (code: string) => Promise<FamilyCodeAccount>;
  /** Invite the account behind a code; throws an error with the message to show. */
  onInvite: (code: string) => Promise<void>;
  /** The people verified before who are not in the folder yet, offered before the code field. */
  people?: KnownPerson[];
  /** Invite somebody verified before; throws an error with the message to show. */
  onInvitePerson?: (userId: string) => Promise<void>;
  onClose: () => void;
}

const STEP_COUNT = 3;
const CLOSE_DELAY_SECONDS = 3;

/**
 * Three step wizard that picks somebody verified before or takes a new person's code, confirms who gets invited, and hands
 * out this account's own code for them to accept with.
 */
export const InviteMemberWizard: React.FC<IInviteMemberWizardProps> = ({ isOpen, ownCode, folderName, sharesFolder = false, onLookup, onInvite, people = [], onInvitePerson, onClose }) => {
  const { t } = useTranslation();
  const colors = useColors();
  const [step, setStep] = useState(1);
  const [code, setCode] = useState('');
  const [account, setAccount] = useState<FamilyCodeAccount | null>(null);
  /** The person verified before who was picked instead of entering a code. */
  const [selected, setSelected] = useState<KnownPerson | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [closeCountdown, setCloseCountdown] = useState(CLOSE_DELAY_SECONDS);

  useEffect(() => {
    if (isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset the wizard each time it opens
      setStep(1);
      setCode('');
      setAccount(null);
      setSelected(null);
      setError(null);
      setCloseCountdown(CLOSE_DELAY_SECONDS);
    }
  }, [isOpen]);

  // The last step holds the close button back for a moment, so the instructions get read.
  useEffect(() => {
    if (step !== 3 || closeCountdown <= 0) {
      return undefined;
    }
    const timer = setTimeout(() => setCloseCountdown(previous => previous - 1), 1000);
    return (): void => clearTimeout(timer);
  }, [step, closeCountdown]);

  const trimmedCode = code.trim();
  const username = account?.username ?? '';
  const [invitedBefore, invitedName, invitedAfter] = splitAround(familySharingText.inviteWizardInvited(username), username);
  const [shareBefore, shareName, shareAfter] = splitAround(familySharingText.inviteWizardShareHint(username), username);
  const [confirmBefore, confirmName, confirmAfter] = splitAround(sharesFolder ? familySharingText.inviteWizardConfirmShare(username, folderName) : familySharingText.inviteWizardConfirmFolder(username, folderName), username);
  const canContinue = selected !== null || trimmedCode.length > 0;

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

  const canClose = step !== 3 || closeCountdown <= 0;

  /**
   * Close, unless a step is running or the last step still counts down.
   */
  const close = (): void => {
    if (!isBusy && canClose) {
      onClose();
    }
  };

  const styles = StyleSheet.create({
    bodyText: {
      color: colors.text,
      fontSize: 15,
      marginTop: 8,
    },
    emphasis: {
      fontWeight: '600',
    },
    buttonRow: {
      flexDirection: 'row',
      gap: 12,
      marginTop: 20,
    },
    disabled: {
      opacity: 0.6,
    },
    errorText: {
      color: colors.destructive,
      fontSize: 14,
      marginTop: 8,
    },
    hintText: {
      color: colors.textMuted,
      fontSize: 14,
      marginTop: 8,
    },
    input: {
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
    personName: {
      color: colors.text,
      flex: 1,
      fontSize: 15,
    },
    personOption: {
      alignItems: 'center',
      borderColor: colors.accentBorder,
      borderRadius: 8,
      borderWidth: 1,
      flexDirection: 'row',
      gap: 10,
      marginTop: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    personOptionSelected: {
      backgroundColor: colors.accentBackground,
      borderColor: colors.primary,
    },
    personProblem: {
      color: colors.warning,
      fontSize: 12,
      marginTop: 2,
    },
    personText: {
      flex: 1,
    },
    primaryButton: {
      alignItems: 'center',
      backgroundColor: colors.tint,
      borderRadius: 8,
      flex: 1,
      paddingVertical: 12,
    },
    primaryButtonText: {
      color: colors.white,
      fontSize: 16,
      fontWeight: '600',
    },
    progressBar: {
      borderRadius: 999,
      flex: 1,
      height: 6,
    },
    progressRow: {
      flexDirection: 'row',
      gap: 8,
    },
    progressText: {
      color: colors.textMuted,
      fontSize: 12,
      marginBottom: 16,
      marginTop: 8,
    },
    secondaryButton: {
      alignItems: 'center',
      borderColor: colors.accentBorder,
      borderRadius: 8,
      borderWidth: 1,
      flex: 1,
      paddingVertical: 12,
    },
    secondaryButtonText: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '500',
    },
    busyBox: {
      alignItems: 'center',
      gap: 12,
      paddingVertical: 24,
    },
    busyText: {
      color: colors.textMuted,
      fontSize: 14,
      textAlign: 'center',
    },
    codeSection: {
      marginTop: 20,
    },
    nextStepBox: {
      borderColor: colors.accentBorder,
      borderRadius: 8,
      borderWidth: 1,
      marginTop: 16,
      padding: 12,
    },
    nextStepTitle: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '600',
    },
    shareBlock: {
      marginTop: 12,
    },
    stepTitle: {
      color: colors.text,
      fontSize: 17,
      fontWeight: '600',
    },
    titleRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 8,
    },
  });

  /**
   * One of the two buttons at the bottom of a step.
   */
  const renderButton = (label: string, onPress: () => void, isPrimary: boolean, enabled: boolean = true): React.ReactNode => (
    <TouchableOpacity style={[isPrimary ? styles.primaryButton : styles.secondaryButton, !enabled && styles.disabled]} onPress={onPress} disabled={!enabled}>
      <Text style={isPrimary ? styles.primaryButtonText : styles.secondaryButtonText}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <ModalWrapper isOpen={isOpen} onClose={close} isSubmitting={isBusy || !canClose} title={familySharingText.invitePeople} keyboardAvoiding showHeaderBorder={false} showFooterBorder={false}>
      {/* Progress through the three steps. */}
      <View style={styles.progressRow} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {Array.from({ length: STEP_COUNT }, (_, index) => (
          <View key={index} style={[styles.progressBar, { backgroundColor: index < step ? colors.primary : colors.accentBorder }]} />
        ))}
      </View>
      <Text style={styles.progressText}>{familySharingText.wizardStep(step, STEP_COUNT)}</Text>

      {/* While a step works (looking the code up, or sharing the folder and sending the invitation) its content makes way for a spinner. */}
      {isBusy && (
        <View style={styles.busyBox}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.busyText}>{step === 2 && sharesFolder ? familySharingText.wizardCreating : t('common.loading')}</Text>
        </View>
      )}

      {step === 1 && !isBusy && (
        <View>
          {/* Somebody verified before needs no code; picking them and entering a code exclude each other. */}
          {people.length > 0 && (
            <View>
              <Text style={styles.stepTitle}>{familySharingText.inviteWizardChooseTitle}</Text>
              {people.map(person => {
                const isSelected = selected?.userId === person.userId;
                return (
                  <TouchableOpacity
                    key={person.userId}
                    style={[styles.personOption, isSelected && styles.personOptionSelected, person.problem !== null && styles.disabled]}
                    disabled={person.problem !== null}
                    activeOpacity={0.7}
                    accessibilityState={{ selected: isSelected, disabled: person.problem !== null }}
                    onPress={() => {
                      setSelected(isSelected ? null : person);
                      setCode('');
                    }}
                  >
                    <Ionicons name={isSelected ? 'checkmark-circle' : 'people-outline'} size={20} color={isSelected ? colors.primary : colors.textMuted} />
                    <View style={styles.personText}>
                      <Text style={styles.personName} numberOfLines={1}>{person.username}</Text>
                      {person.problem && <Text style={styles.personProblem}>{person.problem}</Text>}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          <View style={people.length > 0 ? styles.codeSection : undefined}>
            <Text style={styles.stepTitle}>{people.length > 0 ? familySharingText.inviteWizardNewCodeTitle : familySharingText.inviteWizardCodeTitle}</Text>
            <Text style={styles.hintText}>{familySharingText.inviteWizardCodeHint}</Text>
            <TextInput
              style={styles.input}
              value={code}
              onChangeText={value => {
                setCode(value);
                setSelected(null);
              }}
              placeholder={familySharingText.codePlaceholder}
              placeholderTextColor={colors.textMuted}
              keyboardType="number-pad"
              autoCorrect={false}
              autoFocus={people.length === 0}
              returnKeyType="next"
              onSubmitEditing={() => canContinue && void lookup()}
            />
          </View>
          {error && <Text style={styles.errorText}>{error}</Text>}
          <View style={styles.buttonRow}>
            {renderButton(t('common.cancel'), close, false)}
            {renderButton(t('common.next'), () => void lookup(), true, canContinue)}
          </View>
        </View>
      )}

      {step === 2 && !isBusy && (
        <View>
          <Text style={styles.stepTitle}>{familySharingText.inviteWizardConfirmTitle}</Text>
          <Text style={styles.bodyText}>{confirmBefore}<Text style={styles.emphasis}>{confirmName}</Text>{confirmAfter}</Text>
          {error && <Text style={styles.errorText}>{error}</Text>}
          <View style={styles.buttonRow}>
            {renderButton(t('common.back'), () => setStep(1), false)}
            {renderButton(familySharingText.invite, () => void invite(), true)}
          </View>
        </View>
      )}

      {step === 3 && (
        <View>
          <View style={styles.titleRow}>
            <Ionicons name="checkmark-circle" size={22} color={colors.success} />
            <Text style={styles.stepTitle}>{invitedBefore}<Text style={styles.emphasis}>{invitedName}</Text>{invitedAfter}</Text>
          </View>
          {/* What the inviter still has to do: the invitee types this code to accept. */}
          <View style={styles.nextStepBox}>
            <Text style={styles.nextStepTitle}>{familySharingText.inviteWizardNextStep}</Text>
            <Text style={styles.bodyText}>{shareBefore}<Text style={styles.emphasis}>{shareName}</Text>{shareAfter}</Text>
            {ownCode && <View style={styles.shareBlock}><FamilyCode code={ownCode} /></View>}
            <Text style={styles.hintText}>{familySharingText.inviteWizardShareNotSecret}</Text>
          </View>
          <View style={styles.buttonRow}>
            {renderButton(canClose ? t('common.close') : familySharingText.closeCountdown(closeCountdown), close, false, canClose)}
          </View>
        </View>
      )}
    </ModalWrapper>
  );
};

export default InviteMemberWizard;
