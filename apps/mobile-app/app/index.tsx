import { Redirect } from 'expo-router';
import { StyleSheet } from 'react-native';

import LoadingIndicator from '@/components/LoadingIndicator';
import { ThemedView } from '@/components/themed/ThemedView';

/**
 * App index which is the entry point of the app and redirects to the initialize screen.
 * Renders the same loading indicator as _layout.tsx and initialize.tsx to avoid a visual
 * flash during the transition between them.
 */
export default function AppIndex() : React.ReactNode {
  return (
    <>
      <ThemedView style={styles.container}>
        <LoadingIndicator />
      </ThemedView>
      <Redirect href={'/initialize'} />
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'flex-start',
    paddingHorizontal: 20,
    paddingTop: '40%',
  },
});
