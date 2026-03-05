import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

/**
 * Utility class for managing haptic feedback across the app.
 * Provides a centralized way to trigger haptic feedback with platform checks.
 */
export class HapticsUtility {
  /**
   * Checks if the current platform supports haptics.
   * @returns true if platform is iOS or Android, false otherwise
   */
  private static isHapticsAvailable(): boolean {
    return Platform.OS === 'ios' || Platform.OS === 'android';
  }

  /**
   * Triggers impact haptic feedback (for button presses, toggles, etc.)
   * Automatically checks if the platform supports haptics (iOS/Android).
   *
   * @param style - The style of impact feedback (Light, Medium, Heavy, Rigid, Soft)
   */
  static impact(style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Light): void {
    if (!this.isHapticsAvailable()) return;
    Haptics.impactAsync(style);
  }

  /**
   * Triggers notification haptic feedback (for success, error, warning states).
   * Automatically checks if the platform supports haptics (iOS/Android).
   *
   * @param type - The type of notification feedback (Success, Warning, Error)
   */
  static notification(type: Haptics.NotificationFeedbackType): void {
    if (!this.isHapticsAvailable()) return;
    Haptics.notificationAsync(type);
  }

  /**
   * Triggers selection haptic feedback (for picker scrolls, slider movements, etc.)
   * Automatically checks if the platform supports haptics (iOS/Android).
   */
  static selection(): void {
    if (!this.isHapticsAvailable()) return;
    Haptics.selectionAsync();
  }
}
