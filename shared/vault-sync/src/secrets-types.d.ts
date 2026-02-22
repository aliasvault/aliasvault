declare module 'secrets.js-34r7h' {
  /**
   * Split a hex-encoded secret into shares using Shamir's Secret Sharing.
   * @param secret - Hex-encoded secret string
   * @param numShares - Total number of shares to generate
   * @param threshold - Minimum shares required to reconstruct
   * @returns Array of hex-encoded share strings
   */
  export function share(secret: string, numShares: number, threshold: number): string[];

  /**
   * Combine shares to reconstruct the original hex-encoded secret.
   * @param shares - Array of hex-encoded share strings
   * @returns Hex-encoded secret string
   */
  export function combine(shares: string[]): string;

  /**
   * Generate a random hex string of specified bit length.
   * @param bits - Number of bits
   * @returns Hex-encoded random string
   */
  export function random(bits: number): string;

  /**
   * Convert a UTF-8 string to hex.
   * @param str - UTF-8 string
   * @param bytesPerChar - Bytes per character (default: 2)
   * @returns Hex-encoded string
   */
  export function str2hex(str: string, bytesPerChar?: number): string;

  /**
   * Convert a hex string to UTF-8.
   * @param hex - Hex-encoded string
   * @param bytesPerChar - Bytes per character (default: 2)
   * @returns UTF-8 string
   */
  export function hex2str(hex: string, bytesPerChar?: number): string;

  /**
   * Initialize the library with a specific PRNG.
   * @param bits - Number of bits for the finite field
   */
  export function init(bits?: number): void;

  /**
   * Extract share components.
   * @param share - Hex-encoded share string
   * @returns Object with bits, id, and data
   */
  export function extractShareComponents(share: string): {
    bits: number;
    id: number;
    data: string;
  };
}
