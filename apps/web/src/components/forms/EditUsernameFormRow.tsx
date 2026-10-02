import React from 'react';

import FormInput from '@/components/forms/FormInput';
import FormLabel from '@/components/shared/FormLabel';
import Icon from '@/components/shared/Icon';

type EditUsernameFormRowProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onGenerateNewUsername: () => void;
  placeholder?: string;
};

/**
 * Username input with a generate button.
 */
const EditUsernameFormRow: React.FC<EditUsernameFormRowProps> = ({ id, label, value, onChange, onGenerateNewUsername, placeholder = '' }) => (
  <>
    <FormLabel htmlFor={id}>{label}</FormLabel>
    <div className="flex">
      <div className="relative flex-grow">
        <FormInput id={id} attached="right" trailingSpace="none" value={value} onValueChange={onChange} placeholder={placeholder} />
      </div>
      <button type="button" id="generate-username-button" className="px-3 text-gray-500 bg-gray-200 hover:bg-gray-300 focus:ring-4 focus:outline-none focus:ring-gray-300 font-medium rounded-r-lg text-sm dark:text-white dark:bg-gray-600 dark:hover:bg-gray-700 dark:focus:ring-gray-800" onClick={onGenerateNewUsername}>
        <Icon name="refresh" className="w-5 h-5" />
      </button>
    </div>
  </>
);

export default EditUsernameFormRow;
