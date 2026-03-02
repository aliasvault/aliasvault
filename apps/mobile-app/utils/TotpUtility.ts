import * as OTPAuth from 'otpauth';

/**
 * Generates the current TOTP code for the given secret key.
 * Uses standard TOTP settings: SHA1, 6 digits, 30-second period.
 *
 * @param secretKey - Base32-encoded TOTP secret
 * @returns The current 6-digit TOTP code, or empty string on error
 */
export function generateTotpCode(secretKey: string): string {
  try {
    const totp = new OTPAuth.TOTP({
      secret: secretKey,
      algorithm: 'SHA1',
      digits: 6,
      period: 30
    });
    return totp.generate();
  } catch (error) {
    console.error('Error generating TOTP code:', error);
    return '';
  }
}
