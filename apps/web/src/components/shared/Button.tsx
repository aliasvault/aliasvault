import React from 'react';

/** Button colors. */
export type ButtonColor = 'primary' | 'secondary' | 'danger' | 'success';

/** Direction of the arrow a button can show: forward after the label, back before it. */
export type ButtonArrowDirection = 'forward' | 'back';

type ButtonProps = {
  children: React.ReactNode;
  onClick?: () => void;
  isDisabled?: boolean;
  type?: 'button' | 'submit' | 'reset';
  color?: ButtonColor;
  additionalClasses?: string;
  display?: 'inline' | 'flex';
  id?: string;
  arrow?: ButtonArrowDirection;
};

/** Base classes shared by every button-styled element. */
export const BUTTON_BASE_CLASSES = 'center items-center px-3 py-2 text-sm font-medium text-white rounded-lg focus:outline-none focus:ring-4';
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
 * A small arrow icon for a button that moves through a process.
 */
export const ButtonArrow: React.FC<{ direction: ButtonArrowDirection }> = ({ direction }) => (
  <svg className="w-4 h-4 flex-shrink-0 opacity-80" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={direction === 'forward' ? 'M14 5l7 7m0 0l-7 7m7-7H3' : 'M10 19l-7-7m0 0l7-7m-7 7h18'} />
  </svg>
);

/**
 * Button label with an optional arrow, forward after the label and back before it.
 */
export const ButtonLabel: React.FC<{ children: React.ReactNode; arrow?: ButtonArrowDirection }> = ({ children, arrow }) => {
  if (!arrow) {
    return <>{children}</>;
  }
  return (
    <span className="inline-flex items-center justify-center gap-2">
      {arrow === 'back' && <ButtonArrow direction="back" />}
      <span>{children}</span>
      {arrow === 'forward' && <ButtonArrow direction="forward" />}
    </span>
  );
};

/**
 * Generic button.
 */
const Button: React.FC<ButtonProps> = ({ children, onClick, isDisabled = false, type = 'button', color = 'primary', additionalClasses = '', display = 'inline', id, arrow }) => {
  const classes = `${display} ${BUTTON_BASE_CLASSES} ${getButtonColorClasses(color)} ${isDisabled ? DISABLED_CLASSES : ''} ${additionalClasses}`.trim();

  return (
    <button type={type} id={id} onClick={isDisabled ? undefined : onClick} disabled={isDisabled} className={classes}>
      <ButtonLabel arrow={arrow}>{children}</ButtonLabel>
    </button>
  );
};

export default Button;
