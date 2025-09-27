import React, { useEffect } from 'react';

import { useApp } from '@/entrypoints/popup/context/AppContext';

/**
 * Logout page.
 */
const Logout: React.FC = () => {
  const app = useApp();
  /**
   * Logout and navigate to home page.
   */
  useEffect(() => {
    /**
     * Perform logout via async method to ensure logout is completed before navigating to home page.
     */
    const performLogout = async () : Promise<void> => {
      // Logout via app context, this will automatically trigger a navigation to the login page.
      await app.logout();
    };

    performLogout();
  }, [app]);

  // Return null since this is just a functional component that handles logout.
  return null;
};

export default Logout;
