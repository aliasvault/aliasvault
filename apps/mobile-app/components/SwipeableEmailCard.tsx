import { useRef } from 'react';
import { StyleSheet, View, Animated, Alert } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';

import type { MailboxEmail } from '@/utils/dist/shared/models/webapi';

import { useColors } from '@/hooks/useColorScheme';
import { useTranslation } from '@/hooks/useTranslation';
import { useWebApi } from '@/context/WebApiContext';

import { EmailCard } from '@/components/EmailCard';
import { RobustPressable } from '@/components/ui/RobustPressable';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { IconSymbolName } from '@/components/ui/IconSymbolName';
import { emitter } from '@/utils/EventEmitter';

type SwipeableEmailCardProps = {
  email: MailboxEmail;
  onDelete?: (emailId: string) => void;
};

/**
 * Swipeable email card component with swipe-to-delete functionality.
 * Swiping left or right reveals a delete button for 2-step deletion.
 */
export function SwipeableEmailCard({ email, onDelete }: SwipeableEmailCardProps): React.ReactNode {
  const colors = useColors();
  const { t } = useTranslation();
  const webApi = useWebApi();
  const swipeableRef = useRef<Swipeable>(null);

  /**
   * Handle email deletion.
   */
  const handleDelete = async (): Promise<void> => {
    // Trigger haptic feedback
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // Show confirmation alert
    Alert.alert(
      t('emails.deleteEmail'),
      t('emails.deleteEmailConfirm'),
      [
        {
          text: t('common.cancel'),
          style: 'cancel',
          onPress: () => {
            // Close the swipeable
            swipeableRef.current?.close();
          },
        },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async (): Promise<void> => {
            try {
              // Trigger haptic feedback for deletion
              await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

              // Delete the email from the server
              await webApi.delete(`Email/${email.id}`);

              // Close the swipeable
              swipeableRef.current?.close();

              // Notify parent or refresh the list
              if (onDelete) {
                onDelete(email.id);
              } else {
                emitter.emit('refreshEmails');
              }
            } catch (err) {
              // Trigger error haptic feedback
              await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);

              // Show error alert
              Alert.alert(
                t('common.error'),
                err instanceof Error ? err.message : t('emails.errors.deleteFailed')
              );

              // Close the swipeable
              swipeableRef.current?.close();
            }
          },
        },
      ]
    );
  };

  /**
   * Render the right action (delete button) when swiping left.
   */
  const renderRightActions = (
    progress: Animated.AnimatedInterpolation<number>,
    dragX: Animated.AnimatedInterpolation<number>
  ): React.ReactNode => {
    const translateX = dragX.interpolate({
      inputRange: [-80, 0],
      outputRange: [0, 80],
      extrapolate: 'clamp',
    });

    const opacity = progress.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 1],
      extrapolate: 'clamp',
    });

    return (
      <Animated.View
        style={[
          styles.deleteAction,
          {
            transform: [{ translateX }],
            opacity,
          },
        ]}
      >
        <RobustPressable
          style={[styles.deleteButton, { backgroundColor: colors.destructive }]}
          onPress={handleDelete}
        >
          <IconSymbol size={24} name={IconSymbolName.Trash} color="#FFFFFF" />
        </RobustPressable>
      </Animated.View>
    );
  };

  /**
   * Render the left action (delete button) when swiping right.
   */
  const renderLeftActions = (
    progress: Animated.AnimatedInterpolation<number>,
    dragX: Animated.AnimatedInterpolation<number>
  ): React.ReactNode => {
    const translateX = dragX.interpolate({
      inputRange: [0, 80],
      outputRange: [-80, 0],
      extrapolate: 'clamp',
    });

    const opacity = progress.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 1],
      extrapolate: 'clamp',
    });

    return (
      <Animated.View
        style={[
          styles.deleteAction,
          {
            transform: [{ translateX }],
            opacity,
          },
        ]}
      >
        <RobustPressable
          style={[styles.deleteButton, { backgroundColor: colors.destructive }]}
          onPress={handleDelete}
        >
          <IconSymbol size={24} name={IconSymbolName.Trash} color="#FFFFFF" />
        </RobustPressable>
      </Animated.View>
    );
  };

  /**
   * Handle swipe begin to provide haptic feedback.
   */
  const handleSwipeableWillOpen = async (): Promise<void> => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const styles = StyleSheet.create({
    deleteAction: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'center',
      marginBottom: 12,
    },
    deleteButton: {
      alignItems: 'center',
      borderRadius: 8,
      height: '100%',
      justifyContent: 'center',
      width: 80,
    },
  });

  return (
    <Swipeable
      ref={swipeableRef}
      renderRightActions={renderRightActions}
      renderLeftActions={renderLeftActions}
      onSwipeableWillOpen={handleSwipeableWillOpen}
      overshootRight={false}
      overshootLeft={false}
      rightThreshold={40}
      leftThreshold={40}
    >
      <EmailCard email={email} />
    </Swipeable>
  );
}
