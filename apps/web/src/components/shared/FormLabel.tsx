import React from 'react';

type FormLabelProps = {
  children: React.ReactNode;
  htmlFor?: string;
};

/**
 * Label above a form field.
 */
const FormLabel: React.FC<FormLabelProps> = ({ children, htmlFor }) => (
  <label htmlFor={htmlFor} className="block mb-2 text-sm font-medium text-gray-900 dark:text-white">{children}</label>
);

export default FormLabel;
