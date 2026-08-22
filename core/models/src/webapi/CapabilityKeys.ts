/**
 * The capability keys the server resolves and hands to clients on the status response.
 *
 * Mirrored on the server side in AliasVault.Shared.Server/Capabilities/CapabilityKeys.cs.
 */
export const CapabilityKeys = {
  /**
   * Shared manifests: creating one, inviting people to it, and accepting an invitation to one. The capability
   * behind the Family Sharing screens, and behind anything else built on a vault more than one account holds.
   */
  VaultSharing: 'vault-sharing',
} as const;

/**
 * A capability key known to this build.
 */
export type CapabilityKey = typeof CapabilityKeys[keyof typeof CapabilityKeys];

/**
 * Whether a resolved value means the capability is on. Anything that is not "true" is off, so a value this build
 * does not understand fails closed rather than exposing a capability.
 * @param value - the value the server resolved, or undefined when it did not mention the key at all.
 */
export function isCapabilityEnabled(value: string | undefined): boolean {
  return value?.toLowerCase() === 'true';
}
