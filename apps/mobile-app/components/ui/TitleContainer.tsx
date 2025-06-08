import { Platform, StyleSheet, View } from 'react-native';

import Logo from '@/assets/images/logo.svg';
import { OfflineBanner } from '@/components/OfflineBanner';
import { ThemedText } from '@/components/themed/ThemedText';

type TitleContainerProps = {
  title: string;
  showLogo?: boolean;
};

/**
 * Title container component.
 */
export function TitleContainer({ title, showLogo = true }: TitleContainerProps): React.ReactNode {
  // On Android, we don't show the title container as the native header is used, so we only return the offline banner.
  if (Platform.OS === 'android') {
    return (
      <>
        <OfflineBanner />
      </>
    );
  }

  return (
    <>
      <OfflineBanner />
      <View style={styles.titleContainer}>
        {showLogo && <Logo width={40} height={40} style={styles.logo} />}
        <ThemedText type="title">{title}</ThemedText>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  logo: {
    marginBottom: 6,
  },
  titleContainer: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
});
