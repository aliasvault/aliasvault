import React from 'react';

/** Card layouts: `page` for settings pages (side margin), `section` for item page grids, `plain` for neither. */
export type CardVariant = 'page' | 'section' | 'plain';

type CardProps = {
  children: React.ReactNode;
  variant?: CardVariant;
  className?: string;
};

const BASE_CLASSES = 'p-4 mb-4 bg-white border border-gray-200 rounded-lg shadow-sm dark:border-gray-700 sm:p-6 dark:bg-gray-800';

const VARIANT_CLASSES: Record<CardVariant, string> = {
  page: 'mx-4',
  section: '2xl:col-span-2',
  plain: '',
};

/**
 * White bordered card that groups page content.
 */
const Card: React.FC<CardProps> = ({ children, variant = 'page', className = '' }) => (
  <div className={`${BASE_CLASSES} ${VARIANT_CLASSES[variant]} ${className}`.trim()}>
    {children}
  </div>
);

export default Card;
