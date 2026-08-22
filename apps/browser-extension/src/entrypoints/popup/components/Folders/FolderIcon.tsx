import React from 'react';
import { useTranslation } from 'react-i18next';

type FolderIconProps = {
  isShared?: boolean;
  variant?: 'filled' | 'outline';
  className?: string;
  badgeClassName?: string;
};

/**
 * Folder glyph, optionally carrying a small people badge that marks the folder as shared with other people.
 */
const FolderIcon: React.FC<FolderIconProps> = ({
  isShared = false,
  variant = 'filled',
  className = 'w-4 h-4',
  badgeClassName = 'bg-white dark:bg-gray-800 ring-gray-200 dark:ring-gray-600',
}) => {
  const { t } = useTranslation();

  return (
    <span className="relative flex-shrink-0">
      {variant === 'filled' ? (
        <svg className={className} viewBox="0 0 24 24" fill="currentColor">
          <path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z" />
        </svg>
      ) : (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </svg>
      )}
      {isShared && (
        <span
          title={t('sharing.family.sharedVault')}
          className={`absolute -bottom-1 -right-1 flex items-center justify-center w-2.5 h-2.5 rounded-full ring-1 ${badgeClassName}`}
        >
          <svg className="w-2 h-2 text-primary-500 dark:text-primary-400" viewBox="0 0 24 24" fill="currentColor">
            <path d="M4.5 6.375a4.125 4.125 0 118.25 0 4.125 4.125 0 01-8.25 0zM14.25 8.625a3.375 3.375 0 116.75 0 3.375 3.375 0 01-6.75 0zM1.5 19.125a7.125 7.125 0 0114.25 0v.003l-.001.119a.75.75 0 01-.363.63 13.067 13.067 0 01-6.761 1.873c-2.472 0-4.786-.684-6.76-1.873a.75.75 0 01-.364-.63l-.001-.122zM17.25 19.128l-.001.144a2.25 2.25 0 01-.233.96 10.088 10.088 0 005.06-1.01.75.75 0 00.42-.643 4.875 4.875 0 00-6.957-4.611 8.586 8.586 0 011.71 5.157v.003z" />
          </svg>
        </span>
      )}
    </span>
  );
};

export default FolderIcon;
