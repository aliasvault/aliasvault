import React from 'react';

export type TextVariant = 'body' | 'muted';

const VARIANT_CLASSES: Record<TextVariant, string> = {
  body: 'text-sm text-gray-700 dark:text-gray-300',
  muted: 'text-sm text-gray-500 dark:text-gray-400',
};

type TextProps = {
  children: React.ReactNode;
  variant?: TextVariant;
  as?: 'p' | 'span' | 'div';
  className?: string;
  id?: string;
};

/**
 * Paragraph text in one of the shared text styles, so text size and color stay the same across pages.
 */
const Text: React.FC<TextProps> = ({ children, variant = 'body', as: Tag = 'p', className = '', id }) => (
  <Tag id={id} className={`${VARIANT_CLASSES[variant]} ${className}`.trim()}>{children}</Tag>
);

export default Text;
