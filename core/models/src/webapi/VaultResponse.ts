import type { Vault } from "./Vault";

/**
 * Vault response type.
 */
export type VaultResponse = {
  status: number;
  vault: Vault;
}