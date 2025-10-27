import React from 'react';

import { EmailPreview } from '@/entrypoints/popup/components/EmailPreview';
import { useDb } from '@/entrypoints/popup/context/DbContext';

type EmailBlockProps = {
  email: string;
}

/**
 * Render the email block.
 */
const EmailBlock: React.FC<EmailBlockProps> = ({ email }) => {
  const dbContext = useDb();

  /**
   * Check if the email domain is supported.
   */
  const isEmailDomainSupported = async (email: string): Promise<boolean> => {
    const domain = email.split('@')[1]?.toLowerCase();
    if (!domain) {
      return false;
    }

    const vaultMetadata = await dbContext.getVaultMetadata();
    const publicDomains = vaultMetadata?.publicEmailDomains ?? [];
    const privateDomains = vaultMetadata?.privateEmailDomains ?? [];

    return [...publicDomains, ...privateDomains].some(supportedDomain =>
      domain === supportedDomain.toLowerCase()
    );
  };

  if (!isEmailDomainSupported(email)) {
    return null;
  }

  return (
    <>
      {<EmailPreview email={email} />}
    </>
  );
};

export default EmailBlock;