import React from 'react';

import Button from '@/components/shared/Button';
import Icon from '@/components/shared/Icon';

type DeleteAllSelectedButtonProps = {
  onClick: () => void;
  buttonText: string;
};

/**
 * Danger button used for bulk deletes.
 */
const DeleteAllSelectedButton: React.FC<DeleteAllSelectedButtonProps> = ({ onClick, buttonText }) => (
  <Button onClick={onClick} display="flex" color="danger">
    <Icon name="trash" className="w-4 h-4" />
    <span className="ml-2">{buttonText}</span>
  </Button>
);

export default DeleteAllSelectedButton;
