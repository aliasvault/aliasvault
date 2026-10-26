/**
 * Types shared by the Rust core binding and the typed wrappers in RustCore.ts.
 */

export enum AutofillMatchingMode {
  DEFAULT = 'default',
  URL_EXACT = 'urlExact',
  URL_SUBDOMAIN = 'urlSubdomain'
}

/**
 * The URL a favicon is fetched from, paired with the `Logos.Source` key it is stored under.
 */
export type FaviconTarget = {
  url: string;
  source: string;
};

/**
 * Request for identity generation. All fields except `language` are optional.
 */
export type IdentityRequest = {
  /** Dictionary language code (e.g. 'en'); unknown codes fall back to English. */
  language: string;
  /** Gender preference: 'male', 'female' or 'random' (default). */
  gender?: string;
  /** Age range preference as stored in settings (e.g. '21-25' or 'random'). */
  ageRange?: string;
};

/**
 * Name and birth date input for identity-based username/email prefix generation.
 */
export type IdentityNameInput = {
  firstName: string;
  lastName: string;
  /** Birth date; only the leading yyyy year part is used. */
  birthDate: string;
};

/**
 * A single attachment of a parsed email message. Metadata only: fetch the bytes with
 * `extractEmailAttachment` using this attachment's index in {@link ParsedEmail.attachments}.
 */
export type ParsedEmailAttachment = {
  filename: string;
  mimeType: string;
  size: number;
  detached: boolean;
  partIndex: number | null;
};

/** Result of parsing a raw RFC 822 email source. Body fields are null when the message has no such part. */
export type ParsedEmail = {
  htmlBody: string | null;
  textBody: string | null;
  attachments: ParsedEmailAttachment[];
};

/** Credential filter input for autofill matching, as the Rust matcher expects it. */
export type FilterCredentialsInput = {
  credentials: Array<{ id: string; itemName: string; itemUrls: string[] }>;
  currentUrl: string;
  pageTitle: string;
  matchingMode: AutofillMatchingMode;
};

/** Credential filter output: the matched item ids. */
export type FilterCredentialsOutput = { matchedIds: string[] };

/** SRP ephemeral key pair (uppercase hex). */
export type SrpEphemeral = {
  public: string;
  secret: string;
};

/** SRP client session: proof (M1) and shared key (K), uppercase hex. */
export type SrpSession = {
  proof: string;
  key: string;
};

/** The header of an .avex encrypted export (the Rust `AvexHeader`), with its JSON wire names. */
export type AvexHeader = {
  format: string;
  /** The .avex container format version (not the app version). */
  version: string;
  kdf: {
    type: string;
    /** The base64 salt. */
    salt: string;
    params: { DegreeOfParallelism: number; MemorySize: number; Iterations: number };
  };
  encryption: { algorithm: string; encryptedDataOffset: number };
  metadata: { exportedAt: string; appVersion: string | null };
};

/** The PIN attempt counter after a failed attempt (the Rust `pin_register_failure`). */
export type PinFailure = {
  /** The failed-attempt count to store. */
  failedAttempts: number;
  /** Attempts left before the PIN locks; 0 when `locked`. */
  attemptsRemaining: number;
  /** Whether the host must now delete the PIN wrap and disable PIN unlock. */
  locked: boolean;
};

/**
 * The outcome of opening a key chain (the Rust `open_key_chain_with_unlock_key` and `open_key_chain_with_account_key`).
 * Keys are base64; on success `accountKey` is the Account Key the caller stores for later unlocks.
 */
export type KeyChainOpenResult =
  | { status: 'opened'; vaultEncryptionKey: string; accountKey: string; accountPrivateKey: string | null }
  | { status: 'unlockKeyRejected' }
  | { status: 'accountKeyRejected' }
  | { status: 'keyChainUnreadable'; message: string };

/**
 * The encrypted halves of an account key hierarchy: what the server stores, sent as-is in a register or migration payload.
 */
export type AccountKeyBlobs = {
  encryptedAccountKey: string;
  encryptedAccountKeyAlgorithm: string;
  encryptedVek: string;
  accountPublicKey: string;
  encryptedAccountPrivateKey: string;
  signingPublicKey: string;
  encryptedSigningPrivateKey: string;
  accountPublicKeySignature: string;
};

/**
 * A newly created account key hierarchy (the Rust `create_account_key_hierarchy`): the encrypted blobs plus the plaintext halves the client keeps.
 */
export type AccountKeyHierarchy = {
  /** The Account Key (base64) the session stores. */
  accountKey: string;
  vaultEncryptionKey: string;
  accountPrivateKey: string;
  signingPrivateKey: string;
  accountKeys: AccountKeyBlobs;
};

/** An RSA-OAEP-256 2048-bit key pair, both halves as JWK strings (the Rust `RsaKeyPair`). */
export type RsaKeyPair = {
  publicKey: string;
  privateKey: string;
};

/** An opened mobile login approval (the Rust `MobileLoginApproval`): the Account Key (base64) and the session payload JSON. */
export type MobileLoginApproval = {
  accountKey: string;
  payload: string;
};

/** The Account Key (base64) re-encrypted for a new password. */
export type ReencryptedAccountKey = {
  accountKey: string;
  newEncryptedAccountKey: string;
};

