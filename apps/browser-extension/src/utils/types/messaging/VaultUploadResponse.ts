export type VaultUploadResponse = {
    success: boolean,
    error?: string,
    status?: number,
    newRevisionNumber?: number,
    /** Mutation sequence at the start of upload, for race detection */
    mutationSeqAtStart?: number
};
