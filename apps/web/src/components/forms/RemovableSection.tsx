import React from 'react';
import { useTranslation } from 'react-i18next';

type RemovableSectionProps = {
  title?: string;
  canRemove: boolean;
  onRemove: () => void;
  children: React.ReactNode;
};

/**
 * A card section with an optional remove button in the corner.
 */
const RemovableSection: React.FC<RemovableSectionProps> = ({ title = '', canRemove, onRemove, children }) => {
  const { t } = useTranslation();

  return (
    <div className="p-4 mb-4 bg-white border border-gray-200 rounded-lg shadow-sm 2xl:col-span-2 dark:border-gray-700 sm:p-6 dark:bg-gray-800 relative">
      {title.length > 0 && <h3 className="mb-4 text-xl font-semibold dark:text-white">{title}</h3>}
      <div className="grid gap-6">
        {children}
      </div>
      {canRemove && (
        <button type="button" onClick={onRemove} className="absolute top-3 right-3 text-gray-400 hover:text-red-500 transition-colors" title={t('sharedResources.Delete')}>
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
};

export default RemovableSection;
