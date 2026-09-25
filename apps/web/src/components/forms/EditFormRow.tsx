import React from 'react';

type EditFormRowProps = {
  id: string;
  label: string;
  type?: 'text' | 'textarea';
  value: string;
  onChange: (value: string) => void;
  onFocus?: (event: React.FocusEvent<HTMLInputElement>) => void;
  placeholder?: string;
  labelStyle?: 'default' | 'header';
};

/** Classes of every editable text input on the item form. */
export const EDIT_INPUT_CLASSES = 'outline-0 shadow-sm bg-gray-50 border border-gray-300 text-gray-900 sm:text-sm rounded-lg block w-full p-2.5 pr-10 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white';

/**
 * Labeled text input or textarea.
 */
const EditFormRow: React.FC<EditFormRowProps> = ({ id, label, type = 'text', value, onChange, onFocus, placeholder = '', labelStyle = 'default' }) => (
  <>
    {labelStyle === 'header'
      ? <label htmlFor={id} className="mb-4 text-xl font-semibold dark:text-white block">{label}</label>
      : <label htmlFor={id} className="block mb-2 text-sm font-medium text-gray-900 dark:text-white">{label}</label>}
    <div className="relative">
      {type === 'textarea' ? (
        <textarea id={id} style={{ height: '200px' }} className={EDIT_INPUT_CLASSES} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} autoCapitalize="off" autoCorrect="off"></textarea>
      ) : (
        <input type="text" id={id} autoComplete="off" onFocus={onFocus} className={EDIT_INPUT_CLASSES} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} autoCapitalize="off" autoCorrect="off" />
      )}
    </div>
  </>
);

export default EditFormRow;
