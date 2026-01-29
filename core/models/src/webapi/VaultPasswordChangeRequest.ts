import { Vault } from "./Vault";

/**
 * Represents a request to change the users password including a new vault that is encrypted with the new password.
 */
export type VaultPasswordChangeRequest = Vault & {
    currentClientPublicEphemeral: string;
    currentClientSessionProof: string;
    newPasswordSalt: string;
    newPasswordVerifier: string;
}
