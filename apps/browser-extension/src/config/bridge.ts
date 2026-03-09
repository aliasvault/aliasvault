/**
 * SMTP bridge relay configuration.
 *
 * The bridge relay commitment is a well-known testnet value published by
 * the bridge operator. It is used to authorize the bridge relay on the
 * user's VaultRegistry contract via setMailRelay(relayCommit).
 *
 * The commitment is computed as:
 *   persistentCommit<Bytes<32>>(pad(32, "vault:relay:"), relayKey)
 *
 * For MVP/testnet, this is a static value. In production, this would be
 * published by the bridge operator and verified out-of-band.
 */

import { hexToBytes, isValidHex } from '../utils/hex';

/**
 * Bridge relay commitment as hex string (64 chars = 32 bytes).
 * This is the pre-computed commitment of the bridge operator's relay key.
 *
 * TODO: Replace with actual bridge operator's relay commitment when deployed.
 */
const BRIDGE_RELAY_COMMITMENT_HEX =
  '0000000000000000000000000000000000000000000000000000000000000000';

if (!isValidHex(BRIDGE_RELAY_COMMITMENT_HEX, 64)) {
  throw new Error('Invalid BRIDGE_RELAY_COMMITMENT_HEX: must be 64 hex chars');
}

export const BRIDGE_RELAY_COMMITMENT: Uint8Array = hexToBytes(BRIDGE_RELAY_COMMITMENT_HEX);
