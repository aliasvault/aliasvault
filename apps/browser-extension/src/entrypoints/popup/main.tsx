import ReactDOM from 'react-dom/client';

import App from '@/entrypoints/popup/App';
import { AppProvider } from '@/entrypoints/popup/context/AppContext';
import { AuthProvider } from '@/entrypoints/popup/context/AuthContext';
import { DbProvider } from '@/entrypoints/popup/context/DbContext';
import { HeaderButtonsProvider } from '@/entrypoints/popup/context/HeaderButtonsContext';
import { LoadingProvider } from '@/entrypoints/popup/context/LoadingContext';
import { ThemeProvider } from '@/entrypoints/popup/context/ThemeContext';
import { WebApiProvider } from '@/entrypoints/popup/context/WebApiContext';

import i18n from '@/i18n/i18n';

/**
 * Renders the main application.
 */
const renderApp = (): void => {
  const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
  root.render(
    <DbProvider>
      <WebApiProvider>
        <AuthProvider>
          <AppProvider>
            <LoadingProvider>
              <HeaderButtonsProvider>
                <ThemeProvider>
                  <App />
                </ThemeProvider>
              </HeaderButtonsProvider>
            </LoadingProvider>
          </AppProvider>
        </AuthProvider>
      </WebApiProvider>
    </DbProvider>
  );
};

// Wait for i18n to be ready before rendering React. Not waiting can cause issues on some browsers, Firefox on Windows specifically.
if (i18n.isInitialized) {
  renderApp();
} else {
  i18n.on('initialized', renderApp);
}
