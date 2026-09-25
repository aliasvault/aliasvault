/**
 * Local sync bookkeeping: whether the vault holds changes that still have to be pushed, the mutation counter
 * they were recorded at, and whether a sync is running right now.
 */
export type VaultSyncState = {
  isDirty: boolean;
  mutationSequence: number;
  isSyncInProgress: boolean;
};
