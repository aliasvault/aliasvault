import React from 'react';

type AlertVariant = 'info' | 'warning' | 'error' | 'success';

interface IAlertProps {
  variant: AlertVariant;
  children: React.ReactNode;
  className?: string;
}

/**
 * Reusable alert component with consistent styling
 */
const Alert: React.FC<IAlertProps> = ({ variant, children, className = '' }) => {
  const variantStyles = {
    info: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-200',
    warning: 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800 text-yellow-800 dark:text-yellow-200',
    error: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-800 dark:text-red-200',
    success: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-800 dark:text-green-200'
  };

  return (
    <div className={`p-3 border rounded-lg ${variantStyles[variant]} ${className}`}>
      <p className="text-sm">
        {children}
      </p>
    </div>
  );
};

export default Alert;
