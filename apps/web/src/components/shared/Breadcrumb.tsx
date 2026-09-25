import React from 'react';
import { Link } from 'react-router-dom';

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
  <svg className="w-6 h-6 text-gray-400 dark:text-gray-400" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"><path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd"></path></svg>
);

/**
 * Home icon of the first entry.
 */
const HomeIcon: React.FC<{ inline?: boolean }> = ({ inline = false }) => (
  <svg className={`w-5 h-5 mr-2.5 ${inline ? 'inline' : ''}`} fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"><path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z"></path></svg>
);

/**
 * Breadcrumb trail.
 */
const Breadcrumb: React.FC<{ items: BreadcrumbItem[] }> = ({ items }) => (
  <nav className="flex mb-4">
    <ol className="inline-flex items-center space-x-1 text-sm font-medium md:space-x-2">
      {items.map((item, index) => {
        const isFirst = index === 0;
        return (
          <li key={`${item.displayName}-${index}`} className="inline-flex items-center">
            {!isFirst && <ChevronIcon />}
            {item.url !== undefined ? (
              <Link to={item.url} className="inline-flex items-center text-gray-700 hover:text-primary-600 dark:text-gray-300 dark:hover:text-primary-500">
                {isFirst && item.showHomeIcon && <HomeIcon />}
                {item.displayName}
              </Link>
            ) : (
              <span className="text-gray-400 dark:text-gray-400">
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
