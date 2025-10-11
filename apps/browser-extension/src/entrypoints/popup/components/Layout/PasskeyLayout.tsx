import React from 'react';

import Logo from '@/entrypoints/popup/components/Logo';

/**
 * PasskeyLayout - Minimal layout for passkey create/authenticate pages.
 * Shows only the AliasVault logo header, no navigation, no footer.
 */
const PasskeyLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <div className="min-h-screen min-w-[350px] bg-white dark:bg-gray-900 flex flex-col max-h-[600px]">
      {/* Minimal header with just logo */}
      <header className="fixed z-30 w-full bg-white border-b border-gray-200 dark:bg-gray-800 dark:border-gray-700">
        <div className="flex items-center justify-center h-16 px-4">
          <Logo
            width={125}
            height={40}
            showText={true}
            className="text-gray-900 dark:text-white"
          />
          {/* Hide beta badge on Safari as it's not allowed to show non-production badges */}
          {!import.meta.env.SAFARI && (
            <span className="text-primary-500 text-[10px] font-normal">BETA</span>
          )}
        </div>
      </header>

      {/* Main content without footer padding */}
      <main
        className="flex-1 overflow-y-auto bg-gray-100 dark:bg-gray-900"
        style={{
          paddingTop: '64px',
        }}
      >
        <div className="p-4">
          {children}
        </div>
      </main>
    </div>
  );
};

export default PasskeyLayout;
