import React, { forwardRef } from 'react';

type ButtonProps = {
  onClick?: () => void;
  id?: string;
  children: React.ReactNode;
  type?: 'button' | 'submit' | 'reset';
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
};

/**
 * Button component
 */
const Button = forwardRef<HTMLButtonElement, ButtonProps>(({
  onClick,
  id,
  children,
  type = 'button',
  variant = 'primary',
  disabled = false,
}, ref) => {
  const colorClasses = {
    primary: 'bg-primary-500 hover:bg-primary-600',
    secondary: 'bg-gray-500 hover:bg-gray-600'
  };

  return (
    <button
      ref={ref}
      className={`${colorClasses[variant]} disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg px-4 py-2 text-sm w-full`}
      onClick={onClick}
      type={type}
      id={id}
      disabled={disabled}
    >
      {children}
    </button>
  );
});

Button.displayName = 'Button';

export default Button;