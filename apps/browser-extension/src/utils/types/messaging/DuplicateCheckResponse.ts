/**
 * Response type for checking if a login credential already exists in the vault.
 */
export type DuplicateCheckResponse = {
  success: boolean;
  isDuplicate: boolean;
  error?: string;
};
