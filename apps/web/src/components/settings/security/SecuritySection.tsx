import React from 'react';

/**
 * What the security page can ask a section to do.
 */
export type SectionHandle = {
  /** Reload the section's data. */
  loadData: () => Promise<void>;
};

/**
 * "g" date format: short date and time in the user's locale.
 */
export const formatDateTime = (value: string): string => new Date(value).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });

/**
 * Card holding one section of the security settings page.
 */
const SecuritySection: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="p-4 mb-4 mx-4 bg-white border border-gray-200 rounded-lg shadow-sm dark:border-gray-700 sm:p-6 dark:bg-gray-800">
    <h3 className="mb-2 text-lg font-medium text-gray-900 dark:text-white">{title}</h3>
    {children}
  </div>
);

export default SecuritySection;
