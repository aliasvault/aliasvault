/**
 * Represents the type of authentication event.
 */
export enum AuthEventType {
  /**
   * Represents a standard login attempt.
   */
  Login = 1,

  /**
   * Represents a two-factor authentication attempt.
   */
  TwoFactorAuthentication = 2,

  /**
   * Represents a user logout event.
   */
  Logout = 3,

  /**
   * Represents a mobile login attempt (login via QR code from mobile app).
   */
  MobileLogin = 4,

  /**
   * Represents JWT access token refresh event issued by client to API.
   */
  TokenRefresh = 10,

  /**
   * Represents a password reset event.
   */
  PasswordReset = 20,

  /**
   * Represents a password change event.
   */
  PasswordChange = 21,

  /**
   * Represents enabling two-factor authentication in settings.
   */
  TwoFactorAuthEnable = 22,

  /**
   * Represents disabling two-factor authentication in settings.
   */
  TwoFactorAuthDisable = 23,

  /**
   * Represents a user registration event.
   */
  Register = 30,

  /**
   * Represents creation of a shared manifest.
   */
  SharedVaultCreation = 50,

  /**
   * Represents deletion of a shared manifest, confirmed with the master password.
   */
  SharedVaultDeletion = 51,

  /**
   * Represents a user account deletion event.
   */
  AccountDeletion = 99,
}