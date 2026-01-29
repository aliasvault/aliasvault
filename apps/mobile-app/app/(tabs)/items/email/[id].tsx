import React from 'react';

import EmailDetailsScreen from '@/app/(tabs)/emails/[id]';

/**
 * CredentialEmailPreviewScreen Component
 *
 * This screen component displays email details within the credentials tab stack.
 * It reuses the EmailDetailsScreen component from the emails tab stack to maintain
 * consistency and provide a seamless user experience.
 *
 * Purpose:
 * - Avoids forcing users to switch between tab stacks when viewing email details
 * - Maintains UI consistency by reusing the same email details view
 * - Provides a better user experience by keeping context within the credentials flow
 */
export default function CredentialEmailPreviewScreen() : React.ReactNode {
  return <EmailDetailsScreen />;
}
