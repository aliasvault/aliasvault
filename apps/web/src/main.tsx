import '@/platform/ClientServices';

import ReactDOM from 'react-dom/client';

import App from '@/App';
import { loadAppConfig } from '@/config/AppConfig';
import { AuthProvider } from '@/context/AuthContext';
import { CapabilityProvider } from '@/context/CapabilityContext';
import { ConfirmModalProvider } from '@/context/ConfirmModalContext';
import { DbProvider } from '@/context/DbContext';
import { LoadingProvider } from '@/context/LoadingContext';
import { NotificationProvider } from '@/context/NotificationContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { WebApiProvider } from '@/context/WebApiContext';
import { initI18n } from '@/i18n/i18n';

/**
 * Render the application.
 */
const renderApp = (): void => {
  const root = ReactDOM.createRoot(document.getElementById('app') as HTMLElement);
  root.render(
    <ThemeProvider>
      <NotificationProvider>
        <DbProvider>
          <WebApiProvider>
            <AuthProvider>
              <LoadingProvider>
                <ConfirmModalProvider>
                  <CapabilityProvider>
                    <App />
                  </CapabilityProvider>
                </ConfirmModalProvider>
              </LoadingProvider>
            </AuthProvider>
          </WebApiProvider>
        </DbProvider>
      </NotificationProvider>
    </ThemeProvider>
  );
};

/**
 * Load the runtime config and the translations before the first render; the loading screen in index.html stays
 * up until the app has painted.
 */
const bootstrap = async (): Promise<void> => {
  await loadAppConfig();
  await initI18n();
  renderApp();
};

bootstrap().catch((error) => {
  console.error('Failed to start AliasVault:', error);
});
