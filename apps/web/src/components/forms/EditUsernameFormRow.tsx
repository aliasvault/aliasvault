import React from 'react';

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
    <label htmlFor={id} className="block mb-2 text-sm font-medium text-gray-900 dark:text-white">{label}</label>
    <div className="flex">
      <div className="relative flex-grow">
        <input type="text" id={id} autoComplete="off" className="outline-0 shadow-sm bg-gray-50 border border-gray-300 text-gray-900 sm:text-sm rounded-l-lg block w-full p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
      </div>
      <button type="button" id="generate-username-button" className="px-3 text-gray-500 bg-gray-200 hover:bg-gray-300 focus:ring-4 focus:outline-none focus:ring-gray-300 font-medium rounded-r-lg text-sm dark:text-white dark:bg-gray-600 dark:hover:bg-gray-700 dark:focus:ring-gray-800" onClick={onGenerateNewUsername}>
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
        </svg>
      </button>
    </div>
  </>
);

export default EditUsernameFormRow;
