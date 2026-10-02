import React from 'react';
import { useTranslation } from 'react-i18next';

import Icon from '@/components/shared/Icon';

type SmallLoadingIndicatorProps = {
  title?: string;
  spinning?: boolean;
  children?: React.ReactNode;
};

/**
 * Small circular spinner.
 */
const SmallLoadingIndicator: React.FC<SmallLoadingIndicatorProps> = ({ title = '', spinning = true, children }) => {
  const { t } = useTranslation();
  return (
    <div role="status" className="px-2 flex items-center" title={title}>
      <div className="relative inline-flex items-center justify-center">
        {children}
        <Icon name="spinner-flowbite" className={`inline w-8 h-8 text-gray-200 ${spinning ? 'animate-spin fill-primary-600' : ''} dark:text-gray-600`} />
      </div>
      <span className="sr-only">{t('common.loading')}</span>
    </div>
  );
};

export default SmallLoadingIndicator;
