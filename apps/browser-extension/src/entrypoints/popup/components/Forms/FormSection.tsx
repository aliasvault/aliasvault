import React from 'react';

type FormSectionProps = {
  title?: React.ReactNode;
  children: React.ReactNode;
  actions?: React.ReactNode;
};

/**
 * A reusable form section container with consistent styling.
 * Used for grouping related form fields with an optional title and action buttons.
 */
const FormSection: React.FC<FormSectionProps> = ({
  title,
  children,
  actions
}) => {
  return (
    <div className="bg-white dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
      {title && (
        <h2 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white flex items-center justify-between">
          {typeof title === 'string' ? <span>{title}</span> : title}
          {actions && (
            <div className="flex items-center gap-2">
              {actions}
            </div>
          )}
        </h2>
      )}
      <div className="space-y-4">
        {children}
      </div>
    </div>
  );
};

export default FormSection;
