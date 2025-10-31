import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { HashRouter as Router, Routes, Route, useLocation } from 'react-router-dom';
import { sendMessage } from 'webext-bridge/popup';

import DefaultLayout from '@/entrypoints/popup/components/Layout/DefaultLayout';
import PasskeyLayout from '@/entrypoints/popup/components/Layout/PasskeyLayout';
import LoadingSpinner from '@/entrypoints/popup/components/LoadingSpinner';
import { useApp } from '@/entrypoints/popup/context/AppContext';
import { useHeaderButtons } from '@/entrypoints/popup/context/HeaderButtonsContext';
import { useLoading } from '@/entrypoints/popup/context/LoadingContext';
import { NavigationProvider } from '@/entrypoints/popup/context/NavigationContext';
import AuthSettings from '@/entrypoints/popup/pages/auth/AuthSettings';
import Login from '@/entrypoints/popup/pages/auth/Login';
import Unlock from '@/entrypoints/popup/pages/auth/Unlock';
import UnlockSuccess from '@/entrypoints/popup/pages/auth/UnlockSuccess';
import Upgrade from '@/entrypoints/popup/pages/auth/Upgrade';
import CredentialAddEdit from '@/entrypoints/popup/pages/credentials/CredentialAddEdit';
import CredentialDetails from '@/entrypoints/popup/pages/credentials/CredentialDetails';
import CredentialsList from '@/entrypoints/popup/pages/credentials/CredentialsList';
import EmailDetails from '@/entrypoints/popup/pages/emails/EmailDetails';
import EmailsList from '@/entrypoints/popup/pages/emails/EmailsList';
import Index from '@/entrypoints/popup/pages/Index';
import PasskeyAuthenticate from '@/entrypoints/popup/pages/passkeys/PasskeyAuthenticate';
import PasskeyCreate from '@/entrypoints/popup/pages/passkeys/PasskeyCreate';
import Reinitialize from '@/entrypoints/popup/pages/Reinitialize';
import AutofillSettings from '@/entrypoints/popup/pages/settings/AutofillSettings';
import AutoLockSettings from '@/entrypoints/popup/pages/settings/AutoLockSettings';
import ClipboardSettings from '@/entrypoints/popup/pages/settings/ClipboardSettings';
import ContextMenuSettings from '@/entrypoints/popup/pages/settings/ContextMenuSettings';
import LanguageSettings from '@/entrypoints/popup/pages/settings/LanguageSettings';
import PasskeySettings from '@/entrypoints/popup/pages/settings/PasskeySettings';
import Settings from '@/entrypoints/popup/pages/settings/Settings';

import { useMinDurationLoading } from '@/hooks/useMinDurationLoading';

import '@/entrypoints/popup/style.css';
import { clearPendingRedirectUrl } from './hooks/useVaultLockRedirect';

/**
 * Available layout types for different page contexts.
 */
enum LayoutType {
  /** Default layout with header, footer navigation, and full UI */
  DEFAULT = 'default',
  /** Minimal layout for passkey operations - logo only, no footer */
  PASSKEY = 'passkey',
}

/**
 * Route configuration.
 */
type RouteConfig = {
  path: string;
  element: React.ReactNode;
  showBackButton?: boolean;
  title?: string;
  /** Layout type to use for this route. Defaults to LayoutType.DEFAULT if not specified. */
  layout?: LayoutType;
};

/**
 * AppContent - Wrapper component that switches between different layout types
 */
const AppContent: React.FC<{
  routes: RouteConfig[];
  isLoading: boolean;
  message: string | null;
  headerButtons: React.ReactNode;
}> = ({ routes, isLoading, message, headerButtons }) => {
  const location = useLocation();

  // Find the current route configuration
  const currentRoute = routes.find(route => {
    const pattern = route.path.replace(/:\w+/g, '[^/]+');
    const regex = new RegExp(`^${pattern}$`);
    return regex.test(location.pathname);
  });

  // Get layout type, defaulting to DEFAULT if not specified
  const layoutType = currentRoute?.layout ?? LayoutType.DEFAULT;

  // Common loading overlay
  const loadingOverlay = isLoading && (
    <div className="fixed inset-0 bg-white dark:bg-gray-900 z-50 flex items-center justify-center">
      <LoadingSpinner />
    </div>
  );

  // Common routes component
  const routesComponent = (
    <Routes>
      {routes.map((route) => (
        <Route
          key={route.path}
          path={route.path}
          element={route.element}
        />
      ))}
    </Routes>
  );

  // Render based on layout type
  switch (layoutType) {
    case LayoutType.PASSKEY:
      // Passkey layout - minimal UI with just logo header
      return (
        <PasskeyLayout>
          {loadingOverlay}
          {message && (
            <p className="text-red-500 mb-4">{message}</p>
          )}
          {routesComponent}
        </PasskeyLayout>
      );

    case LayoutType.DEFAULT:
    default:
      // Default layout with full header, footer, navigation
      return (
        <>
          {loadingOverlay}
          <DefaultLayout
            routes={routes}
            headerButtons={headerButtons}
            message={message}
          >
            {routesComponent}
          </DefaultLayout>
        </>
      );
  }
};

/**
 * App component.
 */
const App: React.FC = () => {
  const { t } = useTranslation();
  const app = useApp();
  const { isInitialLoading } = useLoading();
  const [isLoading, setIsLoading] = useMinDurationLoading(true, 150);
  const [message, setMessage] = useState<string | null>(null);
  const { headerButtons } = useHeaderButtons();

  // Move routes definition to useMemo to prevent recreation on every render
  const routes: RouteConfig[] = React.useMemo(() => [
    { path: '/', element: <Index />, showBackButton: false },
    { path: '/reinitialize', element: <Reinitialize />, showBackButton: false },
    { path: '/login', element: <Login />, showBackButton: false },
    { path: '/unlock', element: <Unlock />, showBackButton: false },
    { path: '/unlock-success', element: <UnlockSuccess />, showBackButton: false },
    { path: '/upgrade', element: <Upgrade />, showBackButton: false },
    { path: '/auth-settings', element: <AuthSettings />, showBackButton: true, title: t('settings.title') },
    { path: '/credentials', element: <CredentialsList />, showBackButton: false },
    { path: '/credentials/add', element: <CredentialAddEdit />, showBackButton: true, title: t('credentials.addCredential') },
    { path: '/credentials/:id', element: <CredentialDetails />, showBackButton: true, title: t('credentials.credentialDetails') },
    { path: '/credentials/:id/edit', element: <CredentialAddEdit />, showBackButton: true, title: t('credentials.editCredential') },
    { path: '/passkeys/create', element: <PasskeyCreate />, layout: LayoutType.PASSKEY },
    { path: '/passkeys/authenticate', element: <PasskeyAuthenticate />, layout: LayoutType.PASSKEY },
    { path: '/emails', element: <EmailsList />, showBackButton: false },
    { path: '/emails/:id', element: <EmailDetails />, showBackButton: true, title: t('emails.title') },
    { path: '/settings', element: <Settings />, showBackButton: false },
    { path: '/settings/autofill', element: <AutofillSettings />, showBackButton: true, title: t('settings.autofillSettings') },
    { path: '/settings/context-menu', element: <ContextMenuSettings />, showBackButton: true, title: t('settings.contextMenuSettings') },
    { path: '/settings/clipboard', element: <ClipboardSettings />, showBackButton: true, title: t('settings.clipboardSettings') },
    { path: '/settings/language', element: <LanguageSettings />, showBackButton: true, title: t('settings.language') },
    { path: '/settings/auto-lock', element: <AutoLockSettings />, showBackButton: true, title: t('settings.autoLockTimeout') },
    { path: '/settings/passkeys', element: <PasskeySettings />, showBackButton: true, title: t('settings.passkeySettings') },
  ], [t]);

  useEffect(() => {
    if (!isInitialLoading) {
      setIsLoading(false);
    }
  }, [isInitialLoading, setIsLoading]);

  /**
   * Send heartbeat to background every 5 seconds while popup is open.
   * This extends the auto-lock timer to prevent vault locking while popup is active.
   */
  useEffect(() => {
    // Send initial heartbeat
    sendMessage('POPUP_HEARTBEAT', {}, 'background').catch(() => {
      // Ignore errors as background script might not be ready
    });

    // Set up heartbeat interval
    const heartbeatInterval = setInterval(() => {
      sendMessage('POPUP_HEARTBEAT', {}, 'background').catch(() => {
        // Ignore errors as background script might not be ready
      });
    }, 5000); // Send heartbeat every 5 seconds

    // Cleanup: clear interval when popup closes
    return () : void => {
      clearInterval(heartbeatInterval);
    };
  }, []);

  /**
   * On initial load, clear any stale pending redirect URL if popup was not opened with a specific hash path.
   */
  useEffect(() => {
    const hasHashPath = window.location.hash && window.location.hash !== '#/' && window.location.hash !== '#';
    if (!hasHashPath) {
      clearPendingRedirectUrl();
    }
  }, []);

  /**
   * Print global message if it exists.
   */
  useEffect(() => {
    if (app.globalMessage) {
      setMessage(app.globalMessage);
    } else {
      setMessage(null);
    }
  }, [app, app.globalMessage]);

  return (
    <Router>
      <NavigationProvider>
        <AppContent
          routes={routes}
          isLoading={isLoading}
          message={message}
          headerButtons={headerButtons}
        />
      </NavigationProvider>
    </Router>
  );
};

export default App;
