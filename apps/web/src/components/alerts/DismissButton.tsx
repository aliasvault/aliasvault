import React from 'react';
import { useTranslation } from 'react-i18next';

import Icon from '@/components/shared/Icon';

/**
 * Small X button that closes an alert or toast.
 */
const DismissButton: React.FC<{ onClick: () => void }> = ({ onClick }) => {
  const { t } = useTranslation();
  return (
    <button type="button" onClick={onClick} aria-label={t('common.dismiss')} className="relative shrink-0 -m-2 p-2 rounded-md opacity-70 hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-current before:absolute before:inset-0 before:rounded-md before:bg-current before:opacity-0 before:transition-opacity hover:before:opacity-10 active:before:opacity-20">
      <Icon name="x" className="relative w-4 h-4" />
    </button>
  );
};

export default DismissButton;
