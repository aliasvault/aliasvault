export type VaultUploadResponse = {
    success: boolean,
    error?: string,
    status?: number,
    newRevisionNumber?: number,
    cid?: string,
    cidHash?: string,
    retryable?: boolean,
};
