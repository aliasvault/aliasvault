import React from 'react';
import { useTranslation } from 'react-i18next';

import Icon from '@/components/shared/Icon';

type SelectCheckboxProps = {
  isSelected: boolean;
  className?: string;
  onSelect: (range: boolean) => void;
};

/**
 * Small checkbox that selects a row in a list.
 */
const SelectCheckbox: React.FC<SelectCheckboxProps> = ({ isSelected, className = '', onSelect }) => {
  const { t } = useTranslation();

  /**
   * Toggle the row without opening it.
   */
  const handleClick = (e: React.MouseEvent): void => {
    e.stopPropagation();
    onSelect(e.shiftKey);
  };

  const look = isSelected
    ? 'bg-primary-600 border-primary-600 text-white dark:bg-primary-500 dark:border-primary-500'
    : 'bg-white border-gray-300 group-hover/checkbox:border-primary-500 dark:bg-gray-800 dark:border-gray-500 dark:group-hover/checkbox:border-primary-400';

  // Padding widens the click and touch target; the negative margin keeps the visible box in place.
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={isSelected}
      aria-label={t('common.select')}
      onClick={handleClick}
      className={`group/checkbox p-2 -m-2 flex-shrink-0 inline-flex focus:outline-none ${className}`}>
      <span className={`w-[18px] h-[18px] inline-flex items-center justify-center rounded border-2 group-focus-visible/checkbox:ring-2 group-focus-visible/checkbox:ring-primary-500 ${look}`}>
        {isSelected && <Icon name="check" className="w-3 h-3" strokeWidth={3} />}
      </span>
    </button>
  );
};

export default SelectCheckbox;
