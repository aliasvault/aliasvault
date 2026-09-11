/**
 * What a running sync is doing, broadcast to the popup so it can show the matching indicator.
 * 'pull' = downloading a newer server vault, 'push' = uploading local changes, 'idle' = nothing in flight.
 */
export type VaultSyncPhase = 'pull' | 'push' | 'idle';
