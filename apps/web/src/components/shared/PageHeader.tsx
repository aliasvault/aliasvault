import React from 'react';
import { useTranslation } from 'react-i18next';

import Breadcrumb, { type BreadcrumbItem } from '@/components/shared/Breadcrumb';
import H1 from '@/components/shared/H1';

type PageHeaderProps = {
  breadcrumbItems?: BreadcrumbItem[];
  title: string;
  description?: string;
  titleActions?: React.ReactNode;
  customActions?: React.ReactNode;
};

/**
 * Page header with breadcrumbs, title, description and actions.
 */
const PageHeader: React.FC<PageHeaderProps> = ({ breadcrumbItems = [], title, description = '', titleActions, customActions }) => {
  const { t } = useTranslation();
  const items: BreadcrumbItem[] = [{ displayName: t('sharedResources.Home'), url: '/', showHomeIcon: true }, ...breadcrumbItems];

  return (
    <div className="grid grid-cols-1 px-4 pt-6 xl:grid-cols-3 xl:gap-4 dark:bg-gray-900">
      <div className="mb-4 col-span-full xl:mb-2">
        <Breadcrumb items={items} />
        <div className="flex flex-row items-center justify-between gap-4">
          {titleActions ?? <H1>{title}</H1>}
          {customActions && (
            <div className="flex flex-wrap items-center gap-2">
              {customActions}
            </div>
          )}
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">{description}</p>
      </div>
    </div>
  );
};

export default PageHeader;
