import React from 'react';

type ButtonProps = {
  onClick?: () => void;
  id?: string;
  children: React.ReactNode;
  type?: 'button' | 'submit' | 'reset';
  variant?: 'primary' | 'secondary';
};

/**
 * Button component
 */
const Button: React.FC<ButtonProps> = ({
  onClick,
  id,
  children,
  type = 'button',
  variant = 'primary'
}) => {
  const colorClasses = {
    primary: 'bg-primary-500 hover:bg-primary-600',
    secondary: 'bg-gray-500 hover:bg-gray-600'
  };

  return (
    <button
      className={`${colorClasses[variant]} text-white font-medium rounded-lg px-4 py-2 text-sm w-full`}
      onClick={onClick}
      type={type}
      id={id}
    >
      {children}
    </button>
  );
};

export default Button;