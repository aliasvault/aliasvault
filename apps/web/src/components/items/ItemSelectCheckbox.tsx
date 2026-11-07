import React from 'react';
import { useTranslation } from 'react-i18next';

import Icon from '@/components/shared/Icon';

type ItemSelectCheckboxProps = {
  isSelected: boolean;
  hoverOnly?: boolean;
  className?: string;
  onSelect: (range: boolean) => void;
};

/**
 * Small checkbox that selects an item in the item list.
 */
const ItemSelectCheckbox: React.FC<ItemSelectCheckboxProps> = ({ isSelected, hoverOnly = false, className = '', onSelect }) => {
  const { t } = useTranslation();

  /**
   * Toggle the item without opening it.
   */
  const handleClick = (e: React.MouseEvent): void => {
    e.stopPropagation();
    onSelect(e.shiftKey);
  };

  const visibility = hoverOnly ? 'opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity' : '';
  const look = isSelected
    ? 'bg-primary-600 border-primary-600 text-white dark:bg-primary-500 dark:border-primary-500'
    : 'bg-white border-gray-300 group-hover/checkbox:border-primary-500 dark:bg-gray-800 dark:border-gray-500 dark:group-hover/checkbox:border-primary-400';

  // Padding widens the click and touch target; the negative margin keeps the visible box in place.
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={isSelected}
      aria-label={t('items.selection.select')}
      onClick={handleClick}
      className={`group/checkbox p-2 -m-2 flex-shrink-0 inline-flex focus:outline-none ${visibility} ${className}`}>
      <span className={`w-[18px] h-[18px] inline-flex items-center justify-center rounded border-2 group-focus-visible/checkbox:ring-2 group-focus-visible/checkbox:ring-primary-500 ${look}`}>
        {isSelected && <Icon name="check" className="w-3 h-3" strokeWidth={3} />}
      </span>
    </button>
  );
};

export default ItemSelectCheckbox;
