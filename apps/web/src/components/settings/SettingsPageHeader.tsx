import React from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import SettingsIcon, { type SettingsIconName } from '@/components/settings/SettingsIcon';
import Breadcrumb, { type BreadcrumbItem } from '@/components/shared/Breadcrumb';
import H1 from '@/components/shared/H1';
import Icon from '@/components/shared/Icon';

type SettingsPageHeaderProps = {
  icon: SettingsIconName;
  title: string;
  description?: string;
  breadcrumbItems?: BreadcrumbItem[];
  titleSuffix?: React.ReactNode;
  customActions?: React.ReactNode;
  backTo?: { url: string; label: string };
};

/**
 * Header of a settings page: breadcrumbs, then a back button and the page icon top-aligned next to the title and description.
 */
const SettingsPageHeader: React.FC<SettingsPageHeaderProps> = ({ icon, title, description, breadcrumbItems, titleSuffix, customActions, backTo }) => {
  const { t } = useTranslation();
  const items: BreadcrumbItem[] = [
    { displayName: t('common.home'), url: '/', showHomeIcon: true },
    { displayName: t('common.settings'), url: '/settings' },
    ...(breadcrumbItems ?? [{ displayName: title }]),
  ];
  const back = backTo ?? { url: '/settings', label: t('common.settings') };

  return (
    <div className="px-4 pt-6 mb-4 dark:bg-gray-900">
      <Breadcrumb items={items} />
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3 sm:gap-4 min-w-0">
          <Link to={back.url} id="settingsBackButton" title={back.label} className="flex-shrink-0 flex items-center h-12 pl-2.5 pr-4 -ml-2 -mr-1.5 sm:-mr-2.5 rounded-xl text-gray-500 hover:text-gray-900 hover:bg-gray-200 dark:text-gray-400 dark:hover:text-white dark:hover:bg-gray-700 transition-colors">
            <span className="sr-only">{back.label}</span>
            <Icon name="chevron-left" className="w-5 h-5" />
          </Link>
          <span className="flex-shrink-0 flex items-center justify-center w-12 h-12 rounded-xl bg-white border border-gray-200 shadow-sm text-primary-600 dark:bg-gray-800 dark:border-gray-700 dark:text-primary-400">
            <SettingsIcon name={icon} className="w-6 h-6" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <H1>{title}</H1>
              {titleSuffix}
            </div>
            {description && <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{description}</p>}
          </div>
        </div>
        {customActions && <div className="flex flex-wrap items-center gap-2">{customActions}</div>}
      </div>
    </div>
  );
};

export default SettingsPageHeader;
