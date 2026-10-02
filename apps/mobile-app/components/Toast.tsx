import { ThemeColors } from '@aliasvault/models/colors';
import { View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';

type BaseToastProps = {
  text1?: string;
};

type ErrorToastProps = BaseToastProps & {
  text2?: string;
};

const primaryColor = ThemeColors.light.primary;
const errorColor = ThemeColors.light.destructive;
const infoColor = ThemeColors.light.info;
const shadowColor = '#000';
const textColor = '#fff';

const styles = StyleSheet.create({
  text1: {
    color: textColor,
    fontSize: 14,
    fontWeight: '500',
  },
  text2: {
    color: textColor,
    fontSize: 12,
    marginTop: 4,
  },
  toast: {
    backgroundColor: primaryColor,
    borderRadius: 8,
    elevation: 5,
    marginHorizontal: 16,
    padding: 12,
    shadowColor: shadowColor,
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  toastError: {
    backgroundColor: errorColor,
  },
  toastInfo: {
    backgroundColor: infoColor,
  },
  toastSuccess: {
    backgroundColor: primaryColor,
  },
});

/**
 * Success toast component with safe area insets.
 */
const SuccessToast = (props: BaseToastProps): React.ReactNode => {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.toast,
        styles.toastSuccess,
        {
          marginTop: insets.top - 38,
          marginBottom: insets.bottom + 20,
        },
      ]}
    >
      <Text style={styles.text1}>
        {props.text1 ?? ''}
      </Text>
    </View>
  );
};

/**
 * Error toast component with safe area insets.
 */
const ErrorToast = (props: ErrorToastProps): React.ReactNode => {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.toast,
        styles.toastError,
        {
          marginTop: insets.top + 20,
          marginBottom: insets.bottom + 20,
        },
      ]}
    >
      <Text style={styles.text1}>
        {props.text1 ?? ''}
      </Text>
      {props.text2 && (
        <Text style={styles.text2}>
          {props.text2 ?? ''}
        </Text>
      )}
    </View>
  );
};

/**
 * Info toast component with safe area insets.
 */
const InfoToast = (props: BaseToastProps): React.ReactNode => {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.toast,
        styles.toastInfo,
        {
          marginTop: insets.top + 20,
          marginBottom: insets.bottom + 20,
        },
      ]}
    >
      <Text style={styles.text1}>
        {props.text1 ?? ''}
      </Text>
    </View>
  );
};

export const toastConfig = {
  /**
   * Success toast.
   */
  success: SuccessToast,
  /**
   * Error toast.
   */
  error: ErrorToast,
  /**
   * Info toast.
   */
  info: InfoToast,
};

/**
 * AliasVault toast component.
 */
export const AliasVaultToast = (): React.ReactNode => {
  return <Toast config={toastConfig} />;
};
