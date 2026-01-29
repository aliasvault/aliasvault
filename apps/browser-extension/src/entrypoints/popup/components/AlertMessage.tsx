import React from 'react';

export type AlertType = 'error' | 'success' | 'warning' | 'info';

interface IAlertMessageProps {
  type: AlertType;
  message: string;
  className?: string;
}

/**
 * Alert message component for displaying error, success, warning, or info messages.
 * @param props - The component props.
 * @param props.type - The type of alert (error, success, warning, info).
 * @param props.message - The message to display.
 * @param props.className - Optional additional CSS classes.
 * @returns The rendered alert message component.
 */
const AlertMessage: React.FC<IAlertMessageProps> = ({ type, message, className = '' }) => {
  /**
   * Get the appropriate CSS classes based on alert type.
   * @returns CSS class string.
   */
  const getAlertClasses = (): string => {
    const baseClasses = 'p-3 border rounded-md text-sm';

    switch (type) {
      case 'error':
        return `${baseClasses} bg-red-100 dark:bg-red-900/30 border-red-300 dark:border-red-700 text-red-800 dark:text-red-300`;
      case 'success':
        return `${baseClasses} bg-green-100 dark:bg-green-900/30 border-green-300 dark:border-green-700 text-green-800 dark:text-green-300`;
      case 'warning':
        return `${baseClasses} bg-yellow-100 dark:bg-yellow-900/30 border-yellow-300 dark:border-yellow-700 text-yellow-800 dark:text-yellow-300`;
      case 'info':
        return `${baseClasses} bg-blue-100 dark:bg-blue-900/30 border-blue-300 dark:border-blue-700 text-blue-800 dark:text-blue-300`;
      default:
        return baseClasses;
    }
  };

  return (
    <div className={`${getAlertClasses()} ${className}`}>
      {message}
    </div>
  );
};

export default AlertMessage;
