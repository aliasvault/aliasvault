import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Icon from '@/entrypoints/popup/components/Icons/Icon';

type MultiValueFieldProps = {
  id: string;
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
};

/**
 * The non-empty values of a list of rows.
 * @param rows - The rows
 * @returns The values
 */
function filled(rows: string[]): string[] {
  return rows.filter(row => row.trim() !== '');
}

/**
 * A list of text inputs for a multi-value field, with an add button next to the label and a remove button per row.
 */
const MultiValueField: React.FC<MultiValueFieldProps> = ({ id, label, values, onChange }) => {
  const { t } = useTranslation();
  const [rows, setRows] = useState<string[]>(values.length > 0 ? values : ['']);
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  /*
   * Rows are local so an empty row survives while it is being edited; the parent only gets the filled values.
   * A change from outside (a restored form, an item type switch) replaces the rows.
   */
  useEffect(() => {
    setRows(current => {
      const currentValues = filled(current);
      const isSame = currentValues.length === values.length && currentValues.every((value, index) => value === values[index]);
      return isSame ? current : values.length > 0 ? values : [''];
    });
  }, [values]);

  useEffect(() => {
    if (focusIndex !== null) {
      inputs.current[focusIndex]?.focus();
      setFocusIndex(null);
    }
  }, [focusIndex]);

  /**
   * Show new rows and hand the filled values to the parent.
   */
  const update = (next: string[]): void => {
    setRows(next);
    onChange(filled(next));
  };

  /**
   * Add an empty row and focus it; empty rows are dropped on save.
   */
  const add = (): void => {
    setRows([...rows, '']);
    setFocusIndex(rows.length);
  };

  /**
   * Remove a row, keeping one empty row when it was the last.
   */
  const remove = (index: number): void => {
    const next = rows.filter((_, i) => i !== index);
    update(next.length > 0 ? next : ['']);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label htmlFor={`${id}-0`} className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          {label}
        </label>
        <button
          type="button"
          id={`add-${id}`}
          onClick={add}
          className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full transition-colors focus:outline-none text-gray-500 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 border border-dashed border-gray-300 dark:border-gray-600 hover:border-primary-400 dark:hover:border-primary-500"
        >
          <Icon name="plus" className="w-2.5 h-2.5 -ml-0.5" strokeWidth={2.5} />
          <span>{t('common.add')}</span>
        </button>
      </div>
      {rows.map((row, index) => (
        <div key={index} className="relative">
          <input
            id={`${id}-${index}`}
            ref={element => {
              inputs.current[index] = element;
            }}
            type="text"
            value={row}
            onChange={(e) => update(rows.map((value, i) => (i === index ? e.target.value : value)))}
            className={`w-full px-3 py-2 ${rows.length > 1 ? 'pr-10' : ''} border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 dark:bg-gray-700 dark:text-white`}
          />
          {rows.length > 1 && (
            <button
              type="button"
              onClick={() => remove(index)}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center text-gray-300 hover:text-red-400 dark:text-gray-500 dark:hover:text-red-400 transition-colors"
              title={t('common.remove')}
              aria-label={t('common.remove')}
            >
              <Icon name="x" className="w-4 h-4" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
};

export default MultiValueField;
