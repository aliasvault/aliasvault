import { SharingService } from '@aliasvault/client/sharing/SharingService';
import { sharingText } from '@aliasvault/client/sharing/SharingView';
import React, { useEffect, useState } from 'react';

import AccountFingerprint from '@/components/settings/AccountFingerprint';
import SettingsPageHeader from '@/components/settings/SettingsPageHeader';
import Card from '@/components/shared/Card';
import PageContent from '@/components/shared/PageContent';
import SectionTitle from '@/components/shared/SectionTitle';
import { usePageTitle } from '@/hooks/usePageTitle';

/**
 * A numbered list of steps.
 */
const Steps: React.FC<{ steps: readonly string[] }> = ({ steps }) => (
  <ol className="space-y-3">
    {steps.map((step, index) => (
      <li key={step} className="flex items-start gap-3">
        <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary-100 dark:bg-primary-900/50 text-primary-700 dark:text-primary-300 text-xs font-semibold flex items-center justify-center">{index + 1}</span>
        <span className="text-sm text-gray-700 dark:text-gray-300 pt-0.5">{step}</span>
      </li>
    ))}
  </ol>
);

/**
 * How folder sharing works, with this account's fingerprint to hand out.
 */
const FolderSharing: React.FC = () => {
  const [ownFingerprint, setOwnFingerprint] = useState<string | null>(null);

  usePageTitle(sharingText.folderSharingTitle);

  useEffect(() => {
    void SharingService.ownAccountFingerprint().then(setOwnFingerprint);
  }, []);

  return (
    <>
      <SettingsPageHeader icon="sharing" title={sharingText.folderSharingTitle} description={sharingText.folderSharingIntro} />

      <PageContent>
        {ownFingerprint && (
          <div className="mx-4 mb-4">
            <h2 className="mb-2 text-sm font-medium text-gray-900 dark:text-white">{sharingText.yourFingerprint}</h2>
            <AccountFingerprint id="own-account-fingerprint" code={ownFingerprint} variant="bar" className="max-w-md" />
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">{sharingText.yourFingerprintSettingsHint}</p>
          </div>
        )}
        <Card>
          <SectionTitle>{sharingText.shareFolderStepsTitle}</SectionTitle>
          <Steps steps={sharingText.shareFolderSteps} />
        </Card>
        <Card>
          <SectionTitle>{sharingText.joinFolderStepsTitle}</SectionTitle>
          <Steps steps={sharingText.joinFolderSteps} />
        </Card>
      </PageContent>
    </>
  );
};

export default FolderSharing;
