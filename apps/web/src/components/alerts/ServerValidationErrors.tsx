import React from 'react';

import AlertMessageError from '@/components/alerts/AlertMessageError';

/**
 * List of form-level errors.
 */
const ServerValidationErrors: React.FC<{ errors: string[] }> = ({ errors }) => {
  if (errors.length === 0) {
    return null;
  }
  return (
    <div className="messages-container">
      {errors.map((error, index) => (
        <AlertMessageError key={index} message={error} />
      ))}
    </div>
  );
};

export default ServerValidationErrors;
