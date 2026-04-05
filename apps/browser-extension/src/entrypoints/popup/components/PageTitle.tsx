import React from 'react';

/**
 * Props for the PageTitle component.
 */
interface IPageTitleProps {
  /**
   * The title text to display.
   */
  children: React.ReactNode;
  /**
   * Optional additional CSS classes.
   */
  className?: string;
}

/**
 * Shared page title component with consistent styling.
 * Uses the standard title style: text-gray-900 dark:text-white text-xl
 */
const PageTitle: React.FC<IPageTitleProps> = ({ children, className = '' }) => {
  return (
    <h1 className={`text-gray-900 dark:text-white text-xl ${className}`}>
      {children}
    </h1>
  );
};

export default PageTitle;
