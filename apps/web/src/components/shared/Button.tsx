import React from 'react';

/** Button colors. */
export type ButtonColor = 'primary' | 'secondary' | 'danger' | 'success';

type ButtonProps = {
  children: React.ReactNode;
  onClick?: () => void;
  isDisabled?: boolean;
  type?: 'button' | 'submit' | 'reset';
  color?: ButtonColor;
  additionalClasses?: string;
  display?: 'inline' | 'flex';
  id?: string;
};

const BASE_CLASSES = 'center items-center px-3 py-2 text-sm font-medium text-white rounded-lg focus:outline-none focus:ring-4';
const DISABLED_CLASSES = 'bg-gray-400 cursor-not-allowed';

/**
 * The color classes of a button.
 * @param color - the color
 */
export const getButtonColorClasses = (color: ButtonColor): string => {
  switch (color) {
    case 'primary':
      return 'bg-primary-700 hover:bg-primary-800 focus:ring-primary-300 dark:bg-primary-600 dark:hover:bg-primary-700 dark:focus:ring-primary-800';
    case 'danger':
      return 'bg-red-700 hover:bg-red-800 focus:ring-red-300 dark:bg-red-600 dark:hover:bg-red-700 dark:focus:ring-red-800';
    case 'success':
      return 'bg-green-700 hover:bg-green-800 focus:ring-green-300 dark:bg-green-600 dark:hover:bg-green-700 dark:focus:ring-green-800';
    default:
      return 'bg-gray-700 hover:bg-gray-800 focus:ring-gray-300 dark:bg-gray-600 dark:hover:bg-gray-700 dark:focus:ring-gray-800';
  }
};

/**
 * Generic button (the shared Razor Button component).
 */
const Button: React.FC<ButtonProps> = ({ children, onClick, isDisabled = false, type = 'button', color = 'primary', additionalClasses = '', display = 'inline', id }) => {
  const classes = `${display} ${BASE_CLASSES} ${getButtonColorClasses(color)} ${isDisabled ? DISABLED_CLASSES : ''} ${additionalClasses}`.trim();

  return (
    <button type={type} id={id} onClick={isDisabled ? undefined : onClick} disabled={isDisabled} className={classes}>
      {children}
    </button>
  );
};

export default Button;
