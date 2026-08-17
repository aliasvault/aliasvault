import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import HeaderButton from '@/entrypoints/popup/components/HeaderButton';
import { HeaderIconType } from '@/entrypoints/popup/components/Icons/HeaderIcons';
import { ITEM_TYPE_OPTIONS } from '@/entrypoints/popup/components/Items/ItemTypeSelector';

import type { ItemType } from '@/utils/dist/core/models/vault';

type AddItemDropdownProps = {
  onSelect: (type: ItemType) => void;
};

/**
 * Header "+" button that opens a menu listing the item types that can be created.
 */
const AddItemDropdown: React.FC<AddItemDropdownProps> = ({ onSelect }) => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [isFirstRowHovered, setIsFirstRowHovered] = useState(false);

  /** Close the menu, clearing the hover state the unmounted rows can no longer reset. */
  const closeMenu = () : void => {
    setIsOpen(false);
    setIsFirstRowHovered(false);
  };

  /** Close the menu and notify the parent of the chosen type. */
  const handleSelect = (type: ItemType) : void => {
    closeMenu();
    onSelect(type);
  };

  /** Pointer entered the first row. */
  const handleFirstRowEnter = () : void => setIsFirstRowHovered(true);

  /** Pointer left the first row. */
  const handleFirstRowLeave = () : void => setIsFirstRowHovered(false);

  return (
    <div className="relative">
      <HeaderButton
        onClick={() => (isOpen ? closeMenu() : setIsOpen(true))}
        title={t('items.addNewItem')}
        iconType={HeaderIconType.PLUS}
        variant="primary"
        isActive={isOpen}
      />

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={closeMenu}
          />
          {/* Notch pointing back at the button, drawn on top of the menu border */}
          <div
            className={`absolute right-[13px] top-full mt-[3px] w-2.5 h-2.5 rotate-45 border-l border-t border-gray-200 dark:border-gray-700 z-30 ${
              isFirstRowHovered ? 'bg-gray-100 dark:bg-gray-700' : 'bg-white dark:bg-gray-800'
            }`}
          />
          {/* overflow-hidden lets the first/last row's hover fill run into the rounded corners */}
          <div className="absolute right-0 top-full mt-2 w-44 overflow-hidden bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl ring-1 ring-black/5 dark:ring-white/10 z-20">
            {ITEM_TYPE_OPTIONS.map((option, index) => (
              <button
                key={option.type}
                id={`add-item-type-${option.type}`}
                type="button"
                onClick={() => handleSelect(option.type)}
                onMouseEnter={index === 0 ? handleFirstRowEnter : undefined}
                onMouseLeave={index === 0 ? handleFirstRowLeave : undefined}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                <span className="text-primary-500 dark:text-primary-400">
                  {option.iconSvg}
                </span>
                {t(option.titleKey)}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default AddItemDropdown;
