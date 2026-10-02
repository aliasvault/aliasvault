import React from 'react';

import FormInput from '@/components/forms/FormInput';
import FormLabel from '@/components/shared/FormLabel';
import SectionTitle from '@/components/shared/SectionTitle';

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

/**
 * Labeled text input or textarea.
 */
const EditFormRow: React.FC<EditFormRowProps> = ({ id, label, type = 'text', value, onChange, onFocus, placeholder = '', labelStyle = 'default' }) => (
  <>
    {labelStyle === 'header'
      ? <SectionTitle htmlFor={id}>{label}</SectionTitle>
      : <FormLabel htmlFor={id}>{label}</FormLabel>}
    <div className="relative">
      <FormInput id={id} multiline={type === 'textarea'} value={value} onValueChange={onChange} onFocus={onFocus} placeholder={placeholder} />
    </div>
  </>
);

export default EditFormRow;
