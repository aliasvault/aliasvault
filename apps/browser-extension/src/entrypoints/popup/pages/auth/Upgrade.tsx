import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Legacy upgrade page — no longer needed after SQLite → JSON vault migration.
 * VaultStore (JSON format) has no SQL migrations, so hasPendingMigrations is always false.
 * This component exists only as a safety net; it immediately redirects to credentials.
 */
const Upgrade: React.FC = () => {
  const navigate = useNavigate();

  useEffect(() => {
    navigate('/credentials', { replace: true });
  }, [navigate]);

  return null;
};

export default Upgrade;
