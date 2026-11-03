import { SharingService } from '@aliasvault/client/sharing/SharingService';
import { sharingText } from '@aliasvault/client/sharing/SharingView';
import React, { useEffect, useState } from 'react';

import PageTitle from '@/entrypoints/popup/components/PageTitle';
import AccountFingerprint from '@/entrypoints/popup/components/Sharing/AccountFingerprint';
import { useLoading } from '@/entrypoints/popup/context/LoadingContext';

/**
 * A titled card with a numbered list of steps.
 */
const Steps: React.FC<{ title: string; steps: readonly string[] }> = ({ title, steps }) => (
  <section className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
    <h3 className="font-medium text-gray-900 dark:text-white mb-3">{title}</h3>
    <ol className="space-y-2.5">
      {steps.map((step, index) => (
        <li key={step} className="flex items-start gap-2.5">
          <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary-100 dark:bg-primary-900/50 text-primary-700 dark:text-primary-300 text-xs font-semibold flex items-center justify-center">{index + 1}</span>
          <span className="text-sm text-gray-700 dark:text-gray-300">{step}</span>
        </li>
      ))}
    </ol>
  </section>
);

/**
 * How folder sharing works, with this account's fingerprint to hand out.
 */
const FolderSharingSettings: React.FC = () => {
  const { setIsInitialLoading } = useLoading();
  const [ownFingerprint, setOwnFingerprint] = useState<string | null>(null);

  useEffect(() => {
    void SharingService.ownAccountFingerprint().then(setOwnFingerprint).finally(() => setIsInitialLoading(false));
  }, [setIsInitialLoading]);

  return (
    <div className="space-y-4">
      <PageTitle>{sharingText.folderSharingTitle}</PageTitle>
      <p className="text-sm text-gray-600 dark:text-gray-400">{sharingText.folderSharingIntro}</p>

      {ownFingerprint && (
        <div>
          <h3 className="mb-1.5 text-sm font-medium text-gray-900 dark:text-white">{sharingText.yourFingerprint}</h3>
          <AccountFingerprint id="own-account-fingerprint" code={ownFingerprint} variant="bar" />
          <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">{sharingText.yourFingerprintSettingsHint}</p>
        </div>
      )}

      <Steps title={sharingText.shareFolderStepsTitle} steps={sharingText.shareFolderSteps} />
      <Steps title={sharingText.joinFolderStepsTitle} steps={sharingText.joinFolderSteps} />
    </div>
  );
};

export default FolderSharingSettings;
