import React from 'react';

/**
 * Page heading.
 */
const H1: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h1 className="text-xl font-semibold text-gray-900 sm:text-2xl dark:text-white">{children}</h1>
);

export default H1;
