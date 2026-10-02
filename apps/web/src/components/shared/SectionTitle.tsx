import React from 'react';

type SectionTitleProps = {
  children: React.ReactNode;
  className?: string;
  htmlFor?: string;
};

/**
 * Title of a section card on the item pages.
 */
const SectionTitle: React.FC<SectionTitleProps> = ({ children, className = 'mb-3', htmlFor }) => {
  const classes = `text-lg font-semibold text-gray-900 dark:text-white ${className}`.trim();
  return htmlFor ? <label htmlFor={htmlFor} className={`block ${classes}`}>{children}</label> : <h3 className={classes}>{children}</h3>;
};

export default SectionTitle;
