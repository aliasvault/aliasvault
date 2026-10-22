/**
 * Represents the type of authentication event.
 */
export enum AuthEventType {
  /**
   * Represents a standard login attempt.
   */
  Login = 'login',

  /**
   * Represents a two-factor authentication attempt.
   */
  TwoFactorAuthentication = 'two-factor-authentication',

  /**
   * Represents a user logout event.
   */
  Logout = 'logout',

  /**
   * Represents a mobile login attempt (login via QR code from mobile app).
   */
  MobileLogin = 'mobile-login',

  /**
   * Represents JWT access token refresh event issued by client to API.
   */
  TokenRefresh = 'token-refresh',

  /**
   * Represents a password reset event.
   */
  PasswordReset = 'password-reset',

  /**
   * Represents a password change event.
   */
  PasswordChange = 'password-change',

  /**
   * Represents enabling two-factor authentication in settings.
   */
  TwoFactorAuthEnable = 'two-factor-auth-enable',

  /**
   * Represents disabling two-factor authentication in settings.
   */
  TwoFactorAuthDisable = 'two-factor-auth-disable',

  /**
   * Represents a rotation of the account's encryption keys, confirmed with the master password.
   */
  KeyRotation = 'key-rotation',

  /**
   * Represents raising the key derivation settings of the password to the current defaults.
   */
  KeyDerivationUpgrade = 'key-derivation-upgrade',

  /**
   * Represents a user registration event.
   */
  Register = 'register',

  /**
   * Represents creation of a shared manifest.
   */
  SharedVaultCreation = 'shared-vault-creation',

  /**
   * Represents deletion of a shared manifest, confirmed with the master password.
   */
  SharedVaultDeletion = 'shared-vault-deletion',

  /**
   * Represents an admin taking a member's access to a shared manifest away, confirmed with the master password.
   */
  SharedVaultAccessRevocation = 'shared-vault-access-revocation',

  /**
   * Represents a member giving up their own access to a shared manifest, confirmed with the master password.
   */
  SharedVaultLeave = 'shared-vault-leave',

  /**
   * Represents an admin inviting an account to a shared manifest.
   */
  SharedVaultInvitation = 'shared-vault-invitation',

  /**
   * Represents accepting an invitation to a shared manifest, which gives the account its own grant.
   */
  SharedVaultJoin = 'shared-vault-join',

  /**
   * Represents certifying another account's signing key after checking its account fingerprint.
   */
  KeyCertification = 'key-certification',

  /**
   * Represents a user account deletion event.
   */
  AccountDeletion = 'account-deletion',
}

/**
 * The enum member name of an event type, or the value itself when this build does not know it.
 * @param eventType - the event type as sent by the server.
 */
export function authEventTypeName(eventType: string): string {
  return Object.keys(AuthEventType).find((key) => AuthEventType[key as keyof typeof AuthEventType] === eventType) ?? eventType;
}
