import { familySharingText } from '@aliasvault/client/sharing/FamilySharingView';
import React from 'react';

import Icon from '@/components/shared/Icon';

type FolderIconProps = {
  isShared?: boolean;
  variant?: 'filled' | 'outline';
  className?: string;
  badgeClassName?: string;
};

/**
 * Folder glyph, optionally carrying a small people badge that marks the folder as shared with other people.
 */
const FolderIcon: React.FC<FolderIconProps> = ({ isShared = false, variant = 'filled', className = 'w-4 h-4', badgeClassName = 'bg-white dark:bg-gray-800 ring-gray-200 dark:ring-gray-600' }) => (
  <span className="relative flex-shrink-0">
    {variant === 'filled' ? (
      <Icon name="folder-filled" className={className} />
    ) : (
      <Icon name="folder" className={className} />
    )}
    {isShared && (
      <span title={familySharingText.sharedVault} className={`absolute -bottom-1 -right-1 flex items-center justify-center w-2.5 h-2.5 rounded-full ring-1 ${badgeClassName}`}>
        <Icon name="users" className="w-2 h-2 text-primary-500 dark:text-primary-400" />
      </span>
    )}
  </span>
);

export default FolderIcon;
