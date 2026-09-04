import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Storage key for the developer tools toggle.
 */
const KEY = 'developer_tools_enabled';

/**
 * Service that tracks whether the hidden developer tools screen is reachable.
 */
export const DeveloperToolsService = {
  /**
   * Whether the developer tools should be shown in the settings list.
   */
  async isEnabled(): Promise<boolean> {
    try {
      return await AsyncStorage.getItem(KEY) === 'true';
    } catch (error) {
      console.error('Failed to read developer tools state:', error);
      return false;
    }
  },

  /**
   * Show or hide the developer tools.
   */
  async setEnabled(enabled: boolean): Promise<void> {
    try {
      await AsyncStorage.setItem(KEY, enabled.toString());
    } catch (error) {
      console.error('Failed to store developer tools state:', error);
    }
  },
};
