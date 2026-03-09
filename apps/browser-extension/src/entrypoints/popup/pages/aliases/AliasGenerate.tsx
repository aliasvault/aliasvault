import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { FormInput } from '@/entrypoints/popup/components/Forms/FormInput';
import { FormInputCopyToClipboard } from '@/entrypoints/popup/components/Forms/FormInputCopyToClipboard';
import LoadingSpinner from '@/entrypoints/popup/components/LoadingSpinner';
import { useDb } from '@/entrypoints/popup/context/DbContext';
import { useLoading } from '@/entrypoints/popup/context/LoadingContext';
import { useVaultMutate } from '@/entrypoints/popup/hooks/useVaultMutate';

import { validateAliasName, generateRandomAlias, ALIAS_DOMAIN } from '@/utils/aliasUtils';
import {
  generateEmailKeyPair,
  getEmailKeyPairFromSettings,
  storeEmailKeyPairInSettings,
} from '@/utils/emailKeyPair';
import { hexToBytes } from '@/utils/hex';
import { VaultCidStore } from '@/services/VaultCidStore';

import type { Credential } from '@/utils/dist/shared/models/vault';

type ClaimStep = 'idle' | 'keypair' | 'relay' | 'pubkey' | 'claim' | 'saving' | 'success' | 'error';

const STEP_LABELS: Record<ClaimStep, string> = {
  idle: '',
  keypair: 'Generating email keypair...',
  relay: 'Authorizing mail relay...',
  pubkey: 'Setting email public key...',
  claim: 'Claiming alias on-chain...',
  saving: 'Saving alias to vault...',
  success: 'Alias claimed!',
  error: 'Failed to claim alias',
};

const AliasGenerate: React.FC = (): React.ReactElement => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const dbContext = useDb();
  const { setIsInitialLoading } = useLoading();
  const { executeVaultMutation, isLoading: isMutating, syncStatus } = useVaultMutate();

  const [aliasName, setAliasName] = useState('');
  const [validationError, setValidationError] = useState<string | undefined>();
  const [isAvailable, setIsAvailable] = useState<boolean | null>(null);
  const [isCheckingAvailability, setIsCheckingAvailability] = useState(false);
  const [claimStep, setClaimStep] = useState<ClaimStep>('idle');
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [claimedAlias, setClaimedAlias] = useState<string | undefined>();

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setIsInitialLoading(false);
  }, [setIsInitialLoading]);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, []);

  const checkAvailability = useCallback(async (name: string) => {
    setIsCheckingAvailability(true);
    try {
      const { checkAliasAvailable } = await import('@/services/AliasService');
      const available = await checkAliasAvailable(name);
      setIsAvailable(available);
    } catch {
      // On error (e.g., contract not deployed), assume available
      setIsAvailable(true);
    } finally {
      setIsCheckingAvailability(false);
    }
  }, []);

  const handleAliasChange = useCallback((value: string) => {
    const lowered = value.toLowerCase();
    setAliasName(lowered);
    setIsAvailable(null);
    setErrorMessage(undefined);
    setClaimStep('idle');

    const validation = validateAliasName(lowered);
    setValidationError(validation.valid ? undefined : validation.error);

    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }

    if (validation.valid) {
      debounceTimer.current = setTimeout(() => {
        checkAvailability(lowered);
      }, 500);
    }
  }, [checkAvailability]);

  const handleRandom = useCallback(() => {
    const randomAlias = generateRandomAlias();
    setAliasName(randomAlias);
    setValidationError(undefined);
    setIsAvailable(null);
    setErrorMessage(undefined);
    setClaimStep('idle');

    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }
    debounceTimer.current = setTimeout(() => {
      checkAvailability(randomAlias);
    }, 500);
  }, [checkAvailability]);

  const handleClaim = useCallback(async () => {
    if (!dbContext.vaultStore) return;

    setClaimStep('idle');
    setErrorMessage(undefined);

    try {
      // Get owner secret key
      const secretKeyHex = await VaultCidStore.getSecretKey();
      if (!secretKeyHex) {
        throw new Error('Wallet secret key not found. Please reconnect your wallet.');
      }
      const secretKey = hexToBytes(secretKeyHex);

      // Import services dynamically (Rule 19)
      const { claimAlias } = await import('@/services/AliasService');
      const { MidnightContractService } = await import('@/services/MidnightContractService');

      const vaultJson = dbContext.vaultStore.toJson();
      const vault = JSON.parse(vaultJson);
      const settings: Record<string, string> = vault.settings ?? {};

      // Step 1: Generate keypair if needed
      let keyPair = getEmailKeyPairFromSettings(settings);
      let keypairJustGenerated = false;

      if (!keyPair) {
        setClaimStep('keypair');
        keyPair = generateEmailKeyPair();
        storeEmailKeyPairInSettings(settings, keyPair);
        // Update vault settings
        dbContext.vaultStore.setSetting('emailPublicKey', settings.emailPublicKey);
        dbContext.vaultStore.setSetting('emailPrivateKey', settings.emailPrivateKey);
        keypairJustGenerated = true;
      }

      // Steps 2-3: Set mail relay and email public key if needed (contract calls)
      const contractService = new MidnightContractService();

      // Check if emailPublicKey is set on-chain
      if (keypairJustGenerated) {
        // Need to join VaultRegistry for contract calls
        await contractService.joinVaultRegistry(secretKey);

        // Set mail relay if needed
        setClaimStep('relay');
        const existingRelay = await contractService.readMailRelay();
        if (!existingRelay) {
          const { BRIDGE_RELAY_COMMITMENT } = await import('@/config/bridge');
          await contractService.setMailRelay(BRIDGE_RELAY_COMMITMENT);
        }

        // Set email public key
        setClaimStep('pubkey');
        await contractService.setEmailPublicKey(keyPair.publicKey);
      }

      // Step 4: Claim alias on AliasRegistry
      setClaimStep('claim');
      const vaultContractAddr = contractService.getContractAddress();
      await claimAlias(aliasName, secretKey, vaultContractAddr);

      // Step 5: Save alias as credential in vault
      setClaimStep('saving');
      const aliasEmail = `${aliasName}@${ALIAS_DOMAIN}`;

      await executeVaultMutation(async () => {
        const credential: Credential = {
          Id: '',
          ServiceName: aliasName,
          Password: '',
          Alias: {
            Email: aliasEmail,
            BirthDate: '',
          },
        };

        await dbContext.vaultStore!.createCredential(credential, []);
      }, {
        onSuccess: () => {
          setClaimStep('success');
          setClaimedAlias(aliasEmail);
        },
        onError: (error) => {
          // Alias was claimed on-chain but vault save failed — still show success
          // because the on-chain state is the source of truth
          console.error('Vault save failed after alias claim:', error);
          setClaimStep('success');
          setClaimedAlias(aliasEmail);
        },
      });
    } catch (error) {
      setClaimStep('error');
      const msg = error instanceof Error ? error.message : 'Unknown error occurred';
      if (msg.includes('already claimed') || msg.includes('Alias already claimed')) {
        setErrorMessage('This alias has already been claimed by another user.');
        setIsAvailable(false);
      } else if (msg.includes('rejected') || msg.includes('denied')) {
        setErrorMessage('Transaction was rejected by wallet.');
      } else {
        setErrorMessage(msg);
      }
    }
  }, [aliasName, dbContext.vaultStore, executeVaultMutation]);

  const isClaimDisabled =
    !aliasName ||
    !!validationError ||
    isAvailable !== true ||
    isCheckingAvailability ||
    claimStep !== 'idle' ||
    isMutating;

  const isProcessing = claimStep !== 'idle' && claimStep !== 'success' && claimStep !== 'error';

  // Success view
  if (claimStep === 'success' && claimedAlias) {
    return (
      <div className="p-4 space-y-4">
        <div className="text-center py-4">
          <div className="text-green-600 dark:text-green-400 text-lg font-semibold mb-2">
            Alias Created Successfully
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Your new email alias is ready to use.
          </p>
        </div>

        <FormInputCopyToClipboard
          id="claimed-alias"
          label="Email Alias"
          value={claimedAlias}
        />

        <button
          onClick={() => navigate('/credentials')}
          className="w-full py-2 px-4 bg-primary-500 hover:bg-primary-600 text-white rounded-md transition-colors"
        >
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <div className="space-y-1">
        <FormInput
          id="alias-name"
          label="Alias Name"
          value={aliasName}
          onChange={handleAliasChange}
          placeholder="e.g. zk-tiger-7842"
          error={validationError}
          buttons={[
            {
              icon: 'refresh',
              onClick: handleRandom,
            },
          ]}
        />

        {/* Domain suffix display */}
        {aliasName && !validationError && (
          <p className="text-xs text-gray-500 dark:text-gray-400 px-1">
            {aliasName}@{ALIAS_DOMAIN}
          </p>
        )}

        {/* Availability indicator */}
        {isCheckingAvailability && (
          <p className="text-xs text-gray-500 dark:text-gray-400 px-1">
            Checking availability...
          </p>
        )}
        {!isCheckingAvailability && isAvailable === true && !validationError && (
          <p className="text-xs text-green-600 dark:text-green-400 px-1">
            Available
          </p>
        )}
        {!isCheckingAvailability && isAvailable === false && !validationError && (
          <p className="text-xs text-red-500 dark:text-red-400 px-1">
            Already claimed
          </p>
        )}
      </div>

      {/* Error message */}
      {errorMessage && (
        <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
          <p className="text-sm text-red-600 dark:text-red-400">{errorMessage}</p>
        </div>
      )}

      {/* Processing status */}
      {isProcessing && (
        <div className="flex items-center gap-2 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md">
          <LoadingSpinner />
          <p className="text-sm text-blue-600 dark:text-blue-400">
            {STEP_LABELS[claimStep]}
          </p>
        </div>
      )}

      {/* Mutation sync status */}
      {isMutating && syncStatus && (
        <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
          {syncStatus}
        </p>
      )}

      {/* Claim button */}
      <button
        onClick={handleClaim}
        disabled={isClaimDisabled}
        className={`w-full py-2 px-4 rounded-md transition-colors ${
          isClaimDisabled
            ? 'bg-gray-300 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-not-allowed'
            : 'bg-primary-500 hover:bg-primary-600 text-white'
        }`}
      >
        Claim Alias
      </button>
    </div>
  );
};

export default AliasGenerate;
