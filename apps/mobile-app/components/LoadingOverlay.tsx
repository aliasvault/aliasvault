import { StyleSheet, View } from 'react-native';

import { useColors } from '@/hooks/useColorScheme';
import { useTranslation } from '@/hooks/useTranslation';

import LoadingIndicator from '@/components/LoadingIndicator';
import { ThemedButton } from '@/components/themed/ThemedButton';

type LoadingOverlayProps = {
  status: string;
  /** Shows a cancel button below the indicator when set. */
  onCancel?: () => void;
};

/**
 * LoadingOverlay component
 *
 * This component displays a loading indicator overlay over the entire screen.
 * It is used to indicate that a process is in progress and the user should wait.
 *
 */
export default function LoadingOverlay({ status, onCancel }: LoadingOverlayProps): React.ReactNode {
  const colors = useColors();
  const { t } = useTranslation();

  const styles = StyleSheet.create({
    cancelButton: {
      marginTop: 24,
      minWidth: 160,
    },
    container: {
      alignItems: 'center',
      backgroundColor: colors.background,
      bottom: 0,
      justifyContent: 'center',
      left: 0,
      position: 'absolute',
      right: 0,
      top: 0,
      zIndex: 1000,
    },
  });

  return (
    <View style={styles.container}>
      <LoadingIndicator status={status} />
      {onCancel && <ThemedButton title={t('common.cancel')} variant="secondary" onPress={onCancel} style={styles.cancelButton} testID="loading-overlay-cancel-button" />}
    </View>
  );
}