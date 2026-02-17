/**
 * Response type for saving a login credential to the vault.
 */
export type SaveLoginResponse = {
  success: boolean;
  itemId?: string;
  error?: string;
};
