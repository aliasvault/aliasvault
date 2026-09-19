import type { ItemRef } from '@aliasvault/client/database/ItemRef';
import React from 'react';
import { View, StyleSheet } from 'react-native';

import AddEditItemScreen from '@/components/items/AddEditItemScreen';

type ItemFormPageProps = {
  /** The item to edit, absent when creating one. */
  editRef?: ItemRef;
};

/**
 * The add/edit item form as a page.
 */
export const ItemFormPage: React.FC<ItemFormPageProps> = ({ editRef }) => {
  return (
    <View style={styles.container}>
      <AddEditItemScreen editRef={editRef} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingBottom: 60,
    paddingTop: 40,
  },
});
