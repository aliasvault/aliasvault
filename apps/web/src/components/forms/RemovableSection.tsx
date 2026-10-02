import React from 'react';
import { useTranslation } from 'react-i18next';

import Card from '@/components/shared/Card';
import Icon from '@/components/shared/Icon';
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
          <Icon name="x" className="w-5 h-5" />
        </button>
      )}
    </Card>
  );
};

export default RemovableSection;
