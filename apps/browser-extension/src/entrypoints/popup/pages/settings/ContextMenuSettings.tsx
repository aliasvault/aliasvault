import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { sendMessage } from 'webext-bridge/popup';

import PageTitle from '@/entrypoints/popup/components/PageTitle';
import { useLoading } from '@/entrypoints/popup/context/LoadingContext';

import { LocalPreferencesService } from '@/utils/LocalPreferencesService';

/**
 * Context menu settings page component.
 */
const ContextMenuSettings: React.FC = () => {
  const { t } = useTranslation();
  const { setIsInitialLoading } = useLoading();
  const [isContextMenuEnabled, setIsContextMenuEnabled] = useState<boolean>(true);

  /**
   * Load settings.
   */
  const loadSettings = useCallback(async () : Promise<void> => {
    const isEnabled = await LocalPreferencesService.getGlobalContextMenuEnabled();
    setIsContextMenuEnabled(isEnabled);
    setIsInitialLoading(false);
  }, [setIsInitialLoading]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  /**
   * Toggle context menu.
   */
  const toggleContextMenu = async () : Promise<void> => {
    const newContextMenuEnabled = !isContextMenuEnabled;

    await LocalPreferencesService.setGlobalContextMenuEnabled(newContextMenuEnabled);
    await sendMessage('TOGGLE_CONTEXT_MENU', { enabled: newContextMenuEnabled }, 'background');

    setIsContextMenuEnabled(newContextMenuEnabled);
  };

  return (
    <div className="space-y-6">
      <PageTitle>{t('settings.contextMenuSettings')}</PageTitle>
      <section>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-gray-900 dark:text-white">{t('settings.rightClickContextMenu')}</p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 pe-2">
                  {t('settings.contextMenuDescription')}
                </p>
              </div>
              <button
                onClick={toggleContextMenu}
                className={`px-4 py-2 rounded-md transition-colors ${
                  isContextMenuEnabled
                    ? 'bg-green-500 hover:bg-green-600 text-white'
                    : 'bg-red-500 hover:bg-red-600 text-white'
                }`}
              >
                {isContextMenuEnabled ? t('common.enabled') : t('common.disabled')}
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default ContextMenuSettings;
