import React, { forwardRef } from 'react';

type ButtonProps = {
  onClick?: () => void;
  id?: string;
  children: React.ReactNode;
  type?: 'button' | 'submit' | 'reset';
  variant?: 'primary' | 'secondary' | 'danger';
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
  disabled = false
}, ref) => {
  const colorClasses = {
    primary: 'bg-primary-500 hover:bg-primary-600',
    secondary: 'bg-gray-500 hover:bg-gray-600',
    danger: 'bg-red-600 hover:bg-red-700'
  };

  return (
    <button
      ref={ref}
      className={`${colorClasses[variant]} text-white font-medium rounded-lg px-4 py-2 text-sm w-full disabled:opacity-50 disabled:cursor-not-allowed`}
      onClick={onClick}
      disabled={disabled}
      type={type}
      id={id}
    >
      {children}
    </button>
  );
});

Button.displayName = 'Button';

export default Button;