import React from 'react';

type ToggleChipProps = {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
  /** `outlined` gives the unselected chip a border, for chips on a busy background. */
  outlined?: boolean;
};

/**
 * A chip that is on or off, e.g. a character class of the password generator or a selectable domain.
 */
const ToggleChip: React.FC<ToggleChipProps> = ({ selected, onClick, children, title, outlined = false }) => (
  <button type="button" title={title} aria-pressed={selected} onClick={onClick} className={`flex items-center justify-center px-3 py-2 rounded-md text-sm font-medium transition-colors ${selected ? 'bg-primary-600 text-white hover:bg-primary-700' : `bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 ${outlined ? 'border border-gray-300 dark:border-gray-600' : ''}`}`}>
    {children}
  </button>
);

export default ToggleChip;
