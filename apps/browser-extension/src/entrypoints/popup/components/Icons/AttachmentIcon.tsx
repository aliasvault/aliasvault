import React from 'react';

import Icon from '@/entrypoints/popup/components/Icons/Icon';

type AttachmentIconProps = {
  className?: string;
};

/**
 * Paperclip icon used to indicate that an email carries attachments.
 */
export const AttachmentIcon: React.FC<AttachmentIconProps> = ({ className = 'w-4 h-4' }) => (
  <Icon name="paper-clip" className={className} />
);
