import { VaultSqlGenerator } from '../sql/VaultSqlGenerator';

/**
 * Creates a new VaultSqlGenerator instance.
 * @returns A new VaultSqlGenerator instance.
 */
export const CreateVaultSqlGenerator = (): VaultSqlGenerator => {
  return new VaultSqlGenerator();
};