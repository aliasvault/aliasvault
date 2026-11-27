import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import PageTitle from '@/entrypoints/popup/components/PageTitle';
import { SettingsGroup, SettingsToggleRow } from '@/entrypoints/popup/components/Settings/SettingsMenu';
import { useLoading } from '@/entrypoints/popup/context/LoadingContext';

import { LocalPreferencesService } from '@/utils/LocalPreferencesService';
import { sendMessage } from '@/utils/messaging/ExtensionMessaging';

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
    await sendMessage('TOGGLE_CONTEXT_MENU', { enabled: newContextMenuEnabled });

    setIsContextMenuEnabled(newContextMenuEnabled);
  };

  return (
    <div className="space-y-6">
      <PageTitle>{t('settings.contextMenuSettings')}</PageTitle>
      <SettingsGroup>
        <SettingsToggleRow
          label={t('settings.rightClickContextMenu')}
          description={t('settings.contextMenuDescription')}
          checked={isContextMenuEnabled}
          onChange={toggleContextMenu}
        />
      </SettingsGroup>
    </div>
  );
};

export default ContextMenuSettings;
