import React from 'react';
import { View, StyleSheet } from 'react-native';

import AddEditCredentialScreen from './add-edit';

/**
 * AddEditPageScreen Component
 *
 * This screen component displays add/edit credential details as a page
 * instead of a modal. This is because when deeplinking to the add/edit
 * credential screen, the modal presentation gives issues when the vault
 * is locked due to time-out and can freeze the screen. Using a normal
 * page presentation style works around this issue.
 *
 * This component is only used by deep-linking, all normal app links
 * use the normal add-edit.tsx modal component.
 */
export default function AddEditPageScreen(): React.ReactNode {
  return (
    <View style={styles.container}>
      <AddEditCredentialScreen />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingBottom: 60,
    paddingTop: 40,
  },
});
