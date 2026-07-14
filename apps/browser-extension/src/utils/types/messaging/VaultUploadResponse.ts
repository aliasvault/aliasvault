export type VaultUploadResponse = {
    success: boolean,
    error?: string,
    status?: number,
    newRevisionNumber?: number,
    /** Mutation sequence at the start of upload, for race detection */
    mutationSeqAtStart?: number,
    /** Whether expired trash items were pruned from the vault during upload */
    vaultPruned?: boolean
};
