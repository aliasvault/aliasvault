import React from 'react';
import { useTranslation } from 'react-i18next';

import Icon from '@/entrypoints/popup/components/Icons/Icon';

/**
 * Reload button props.
 */
type ReloadButtonProps = {
  onClick: () => void;
};

/**
 * Reload button component.
 */
const ReloadButton: React.FC<ReloadButtonProps> = ({ onClick }) => {
  const { t } = useTranslation();
  return (
    <div
      className="px-2 items-center"
    >
      <div className="relative inline-flex items-center">
        <button id="reload-vault" onClick={onClick} className="absolute p-2 hover:bg-gray-200 rounded-2xl">
          <Icon name="refresh" className="h-4 w-4 text-gray-400" />
        </button>
        <Icon name="spinner-flowbite" className="inline w-8 h-8 text-gray-200 dark:text-gray-600" />
      </div>
      <span className="sr-only">{t('common.loading')}</span>
    </div>
  );
};

export default ReloadButton;