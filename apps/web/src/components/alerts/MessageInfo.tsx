import React from 'react';

import WarningBox from '@/components/alerts/WarningBox';

/**
 * Amber info box with a title.
 */
const MessageInfo: React.FC<{ title?: string; children: React.ReactNode }> = ({ title, children }) => (
  <WarningBox icon="information-circle" title={title} className="mb-6">{children}</WarningBox>
);

export default MessageInfo;
