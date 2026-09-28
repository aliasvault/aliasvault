import React from 'react';
import { useTranslation } from 'react-i18next';

import Card from '@/components/shared/Card';
import SectionTitle from '@/components/shared/SectionTitle';

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
    <Card variant="section" className="relative">
      {title.length > 0 && <SectionTitle>{title}</SectionTitle>}
      <div className="grid gap-4">
        {children}
      </div>
      {canRemove && (
        <button type="button" onClick={onRemove} className="absolute top-3 right-3 text-gray-400 hover:text-red-500 transition-colors" title={t('common.delete')}>
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </Card>
  );
};

export default RemovableSection;
