import React from 'react';

/** Card layouts: `page` for settings pages (side margin), `section` for item page grids, `plain` for neither, `tile` for a grid cell (no margin). */
export type CardVariant = 'page' | 'section' | 'plain' | 'tile';

type CardProps = {
  children: React.ReactNode;
  variant?: CardVariant;
  className?: string;
};

const BASE_CLASSES = 'bg-white border border-gray-200 rounded-lg shadow-sm dark:border-gray-700 dark:bg-gray-800';

const VARIANT_CLASSES: Record<CardVariant, string> = {
  page: 'mb-4 p-4 sm:p-6 mx-4',
  section: 'mb-4 p-4 sm:p-5 2xl:col-span-2',
  plain: 'mb-4 p-4 sm:p-6',
  tile: 'p-4 sm:p-5',
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
