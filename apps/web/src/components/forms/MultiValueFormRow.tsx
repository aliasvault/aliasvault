import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import FormInput from '@/components/forms/FormInput';
import Icon from '@/components/shared/Icon';

type MultiValueFormRowProps = {
  id: string;
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  onFocus?: (event: React.FocusEvent<HTMLInputElement>) => void;
  placeholder?: string;
  addLabel?: string;
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
const MultiValueFormRow: React.FC<MultiValueFormRowProps> = ({ id, label, values, onChange, onFocus, placeholder = '', addLabel }) => {
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
    <>
      <div className="flex items-center justify-between mb-2">
        <label htmlFor={`${id}-0`} className="block text-sm font-medium text-gray-900 dark:text-white">{label}</label>
        <button
          type="button"
          id={`add-${id}`}
          onClick={add}
          className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full transition-colors focus:outline-none text-gray-500 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 border border-dashed border-gray-300 dark:border-gray-600 hover:border-primary-400 dark:hover:border-primary-500"
        >
          <Icon name="plus" className="w-2.5 h-2.5 -ml-0.5" strokeWidth={2.5} />
          <span>{addLabel ?? t('common.add')}</span>
        </button>
      </div>
      <div className="space-y-2">
        {rows.map((row, index) => (
          <div key={index} className="relative">
            <FormInput
              id={`${id}-${index}`}
              ref={(element: HTMLInputElement | null) => {
                inputs.current[index] = element;
              }}
              value={row}
              onValueChange={next => update(rows.map((value, i) => (i === index ? next : value)))}
              onFocus={onFocus}
              placeholder={placeholder}
              trailingSpace={rows.length > 1 ? 'sm' : 'none'}
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
    </>
  );
};

export default MultiValueFormRow;
