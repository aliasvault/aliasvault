import React from 'react';

/**
 * Page body wrapper with a minimum height so header dropdowns are not clipped on short pages.
 */
const PageContent: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <div className={`min-h-[350px] ${className}`}>
    {children}
  </div>
);

export default PageContent;
