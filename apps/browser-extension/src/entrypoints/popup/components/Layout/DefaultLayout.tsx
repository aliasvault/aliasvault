import React from 'react';
import { Routes, Route } from 'react-router-dom';

import { ClipboardCountdownBar } from '@/entrypoints/popup/components/ClipboardCountdownBar';
import BottomNav from '@/entrypoints/popup/components/Layout/BottomNav';
import Header from '@/entrypoints/popup/components/Layout/Header';

/**
 * Route configuration type.
 */
type RouteConfig = {
  path: string;
  element: React.ReactNode;
  showBackButton?: boolean;
  title?: string;
};

/**
 * DefaultLayout props.
 */
type DefaultLayoutProps = {
  routes: RouteConfig[];
  headerButtons: React.ReactNode;
  message?: string | null;
  children?: React.ReactNode;
};

/**
 * DefaultLayout - Standard layout with full header, footer navigation, and complete UI.
 * This is the main layout used for most pages in the extension.
 */
const DefaultLayout: React.FC<DefaultLayoutProps> = ({ routes, headerButtons, message, children }) => {
  return (
    <div className="min-h-screen min-w-[350px] bg-white dark:bg-gray-900 flex flex-col max-h-[600px]">
      <ClipboardCountdownBar />

      <Header
        routes={routes}
        rightButtons={headerButtons}
      />

      <main
        className="flex-1 overflow-y-auto bg-gray-100 dark:bg-gray-900"
        style={{
          paddingTop: '64px',
          height: 'calc(100% - 120px)',
        }}
      >
        <div className="px-4 pb-4 pt-2 mb-16">
          {message && (
            <p className="text-red-500 mb-4">{message}</p>
          )}
          {children || (
            <Routes>
              {routes.map((route) => (
                <Route
                  key={route.path}
                  path={route.path}
                  element={route.element}
                />
              ))}
            </Routes>
          )}
        </div>
      </main>

      <BottomNav />
    </div>
  );
};

export default DefaultLayout;
