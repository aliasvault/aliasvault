import React, { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { FormInput } from '@/entrypoints/popup/components/Forms/FormInput';
import Icon from '@/entrypoints/popup/components/Icons/Icon';
import { useLoading } from '@/entrypoints/popup/context/LoadingContext';

import type { ItemType } from '@aliasvault/models/vault';

/**
 * Item type option configuration.
 */
type ItemTypeOption = {
  type: ItemType;
  titleKey: string;
  iconSvg: React.ReactNode;
};

/**
 * Available item type options.
 */
const ITEM_TYPE_OPTIONS: ItemTypeOption[] = [
  {
    type: 'Login',
    titleKey: 'itemTypes.login.title',
    iconSvg: (
      <Icon name="key" className="w-5 h-5" />
    )
  },
  {
    type: 'Alias',
    titleKey: 'itemTypes.alias.title',
    iconSvg: (
      <Icon name="user" className="w-5 h-5" />
    )
  },
  {
    type: 'CreditCard',
    titleKey: 'itemTypes.creditCard.title',
    iconSvg: (
      <Icon name="credit-card" className="w-5 h-5" />
    )
  },
  {
    type: 'Note',
    titleKey: 'itemTypes.secureNote',
    iconSvg: (
      <Icon name="document-text" className="w-5 h-5" />
    )
  }
];

/**
 * Item type selection page.
 * Allows users to enter item name and choose which type of item to create.
 */
const ItemTypeSelector: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { setIsInitialLoading } = useLoading();
  const [itemName, setItemName] = useState('');
  const [selectedType, setSelectedType] = useState<ItemType>('Login');
  const [showDropdown, setShowDropdown] = useState(false);

  /**
   * Mark page as loaded on mount.
   */
  useEffect(() => {
    setIsInitialLoading(false);
  }, [setIsInitialLoading]);

  /**
   * Handle continue button click.
   */
  const handleContinue = useCallback((): void => {
    const params = new URLSearchParams();
    params.set('type', selectedType);
    if (itemName.trim()) {
      params.set('itemTitle', itemName.trim());
    }
    navigate(`/items/add?${params.toString()}`);
  }, [selectedType, itemName, navigate]);

  /**
   * Handle item type selection from dropdown.
   */
  const handleSelectType = useCallback((type: ItemType): void => {
    setSelectedType(type);
    setShowDropdown(false);
  }, []);

  const selectedOption = ITEM_TYPE_OPTIONS.find(opt => opt.type === selectedType);

  return (
    <div className="p-4 space-y-6">
      {/* Service Name Input */}
      <div>
        <FormInput
          id="itemName"
          label={t('common.serviceName')}
          value={itemName}
          onChange={setItemName}
          type="text"
          placeholder={t('common.serviceName')}
        />
      </div>

      {/* Item Type Selector */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          {t('itemTypes.typeLabel')}
        </label>
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowDropdown(!showDropdown)}
            className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 flex items-center justify-between"
          >
            <div className="flex items-center gap-3">
              <span className="text-primary-600 dark:text-primary-400">
                {selectedOption?.iconSvg}
              </span>
              <span className="font-medium">
                {selectedOption ? t(selectedOption.titleKey) : ''}
              </span>
            </div>
            <Icon name="chevron-down" className={`w-5 h-5 text-gray-400 transition-transform ${showDropdown ? 'rotate-180' : ''}`} />
          </button>

          {/* Dropdown Menu */}
          {showDropdown && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setShowDropdown(false)}
              />
              <div className="absolute z-20 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg">
                {ITEM_TYPE_OPTIONS.map((option) => (
                  <button
                    key={option.type}
                    type="button"
                    onClick={() => handleSelectType(option.type)}
                    className={`w-full px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-3 border-b border-gray-100 dark:border-gray-700 last:border-b-0 ${
                      selectedType === option.type
                        ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300'
                        : 'text-gray-900 dark:text-white'
                    }`}
                  >
                    <span className={selectedType === option.type ? 'text-primary-600 dark:text-primary-400' : 'text-gray-500 dark:text-gray-400'}>
                      {option.iconSvg}
                    </span>
                    <span className="font-medium">
                      {t(option.titleKey)}
                    </span>
                    {selectedType === option.type && (
                      <Icon name="check" className="w-5 h-5 ml-auto text-primary-600 dark:text-primary-400" />
                    )}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Continue Button */}
      <button
        type="button"
        onClick={handleContinue}
        className="w-full px-4 py-3 bg-primary-600 text-white rounded-md hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 font-medium"
      >
        {t('common.next')}
      </button>
    </div>
  );
};

export default ItemTypeSelector;
