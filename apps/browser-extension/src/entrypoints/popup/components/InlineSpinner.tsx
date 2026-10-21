import React from 'react';

import Icon from '@/entrypoints/popup/components/Icons/Icon';

/**
 * A spinner with a line of text, shown in place of a dialog's content while it works.
 */
const InlineSpinner: React.FC<{ text: string }> = ({ text }) => (
  <div className="flex flex-col items-center justify-center gap-3 py-8" role="status">
    <Icon name="spinner" className="w-8 h-8 animate-spin text-primary-500" />
    <p className="text-sm text-center text-gray-600 dark:text-gray-300">{text}</p>
  </div>
);

export default InlineSpinner;
