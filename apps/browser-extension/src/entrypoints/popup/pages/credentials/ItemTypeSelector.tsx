import React, { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { FormInput } from '@/entrypoints/popup/components/Forms/FormInput';
import { useLoading } from '@/entrypoints/popup/context/LoadingContext';

import type { ItemType } from '@/utils/dist/core/models/vault';

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
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
      </svg>
    )
  },
  {
    type: 'Alias',
    titleKey: 'itemTypes.alias.title',
    iconSvg: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
      </svg>
    )
  },
  {
    type: 'CreditCard',
    titleKey: 'itemTypes.creditCard.title',
    iconSvg: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
      </svg>
    )
  },
  {
    type: 'Note',
    titleKey: 'itemTypes.note.title',
    iconSvg: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
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
      params.set('name', itemName.trim());
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
          label={t('credentials.serviceName')}
          value={itemName}
          onChange={setItemName}
          type="text"
          placeholder={t('credentials.serviceName')}
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
            <svg
              className={`w-5 h-5 text-gray-400 transition-transform ${showDropdown ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
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
                      <svg className="w-5 h-5 ml-auto text-primary-600 dark:text-primary-400" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
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
