import React from 'react';
import { Link } from 'react-router-dom';

import Icon from '@/components/shared/Icon';

/**
 * One breadcrumb entry.
 */
export type BreadcrumbItem = {
  displayName: string;
  /** Where the entry links to; the current page has none. */
  url?: string;
  /** Show the home icon (the first entry). */
  showHomeIcon?: boolean;
};

/**
 * Separator between breadcrumb entries.
 */
const ChevronIcon: React.FC = () => (
  <Icon name="chevron-right" className="w-6 h-6 text-gray-400 dark:text-gray-400" />
);

/**
 * Home icon of the first entry.
 */
const HomeIcon: React.FC<{ inline?: boolean }> = ({ inline = false }) => (
  <Icon name="home" className={`w-5 h-5 mr-2 ${inline ? 'inline' : ''}`} />
);

/**
 * Breadcrumb trail.
 */
const Breadcrumb: React.FC<{ items: BreadcrumbItem[] }> = ({ items }) => (
  <nav className="flex mb-4">
    <ol className="inline-flex items-center -ml-1.5 space-x-0.5 text-sm font-medium md:space-x-1">
      {items.map((item, index) => {
        const isFirst = index === 0;
        return (
          <li key={`${item.displayName}-${index}`} className="inline-flex items-center">
            {!isFirst && <ChevronIcon />}
            {item.url !== undefined ? (
              <Link to={item.url} className="inline-flex items-center px-1.5 py-1 rounded-md text-gray-700 hover:text-gray-900 hover:bg-gray-200 focus-visible:outline-none focus-visible:text-gray-900 focus-visible:bg-gray-200 dark:text-gray-300 dark:hover:text-white dark:hover:bg-gray-700 dark:focus-visible:text-white dark:focus-visible:bg-gray-700 transition-colors">
                {isFirst && item.showHomeIcon && <HomeIcon />}
                {item.displayName}
              </Link>
            ) : (
              <span className="px-1.5 py-1 text-gray-400 dark:text-gray-400">
                {isFirst && item.showHomeIcon && <HomeIcon inline />}
                {item.displayName}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  </nav>
);

export default Breadcrumb;
