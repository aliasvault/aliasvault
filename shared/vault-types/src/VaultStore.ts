import type { Credential, Attachment, EncryptionKey, PasswordSettings, TotpCode, Passkey } from '@aliasvault/models/vault';
import type { VaultJson, CredentialTree, EncryptionKeyEntry } from './types';

const CURRENT_VERSION = 1;

function binaryToBase64(data: Uint8Array | number[]): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let binaryString = '';
  for (let i = 0; i < bytes.length; i++) {
    binaryString += String.fromCharCode(bytes[i]);
  }
  return btoa(binaryString);
}

function base64ToBinary(b64: string): Uint8Array {
  const binaryString = atob(b64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function toLogo(logo: Uint8Array | number[] | undefined): string | undefined {
  if (!logo) {
    return undefined;
  }
  if (typeof logo === 'object' && !ArrayBuffer.isView(logo) && !Array.isArray(logo)) {
    const values = Object.values(logo) as number[];
    return binaryToBase64(new Uint8Array(values));
  }
  return binaryToBase64(logo);
}

export class VaultStore {
  private vault: VaultJson;

  private constructor(vault: VaultJson) {
    this.vault = vault;
  }

  // --- Lifecycle ---

  static fromJson(json: string): VaultStore {
    const parsed = JSON.parse(json) as VaultJson;
    if (!parsed.version) {
      parsed.version = 1;
    }
    if (parsed.version > CURRENT_VERSION) {
      throw new Error(
        `Vault version ${parsed.version} is not supported. Maximum supported version: ${CURRENT_VERSION}. Please update the application.`
      );
    }
    if (!parsed.credentials) {
      parsed.credentials = {};
    }
    if (!parsed.settings) {
      parsed.settings = {};
    }
    if (!parsed.encryptionKeys) {
      parsed.encryptionKeys = [];
    }
    return new VaultStore(parsed);
  }

  toJson(): string {
    this.vault.version = CURRENT_VERSION;
    this.vault.lastModified = Date.now();
    return JSON.stringify(this.vault);
  }

  static createEmpty(): VaultStore {
    return new VaultStore({
      version: CURRENT_VERSION,
      credentials: {},
      settings: {},
      encryptionKeys: [],
    });
  }

  // --- Credential CRUD ---

  getAllCredentials(): Credential[] {
    return Object.values(this.vault.credentials)
      .filter(tree => !tree.isDeleted)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(tree => this.treeToCredential(tree));
  }

  getCredentialById(id: string): Credential | null {
    const tree = this.vault.credentials[id];
    if (!tree || tree.isDeleted) {
      return null;
    }
    return this.treeToCredential(tree);
  }

  async createCredential(
    credential: Credential,
    attachments: Attachment[],
    totpCodes: TotpCode[] = []
  ): Promise<string> {
    const id = crypto.randomUUID().toUpperCase();
    const ts = Date.now();

    const tree: CredentialTree = {
      id,
      serviceName: credential.ServiceName,
      serviceUrl: credential.ServiceUrl,
      logo: toLogo(credential.Logo),
      username: credential.Username,
      password: { value: credential.Password, createdAt: ts, updatedAt: ts },
      notes: credential.Notes,
      alias: {
        firstName: credential.Alias.FirstName,
        lastName: credential.Alias.LastName,
        nickName: credential.Alias.NickName,
        birthDate: credential.Alias.BirthDate,
        gender: credential.Alias.Gender,
        email: credential.Alias.Email,
      },
      attachments: (attachments ?? []).map(att => ({
        id: crypto.randomUUID().toUpperCase(),
        filename: att.Filename,
        blob: binaryToBase64(att.Blob),
        createdAt: ts,
        updatedAt: ts,
        isDeleted: false,
      })),
      totpCodes: (totpCodes ?? [])
        .filter(tc => !tc.IsDeleted)
        .map(tc => ({
          id: tc.Id || crypto.randomUUID().toUpperCase(),
          name: tc.Name,
          secretKey: tc.SecretKey,
          isDeleted: false,
        })),
      passkeys: [],
      createdAt: ts,
      updatedAt: ts,
      isDeleted: false,
    };

    this.vault.credentials[id] = tree;
    return id;
  }

  async updateCredentialById(
    credential: Credential,
    originalAttachmentIds: string[],
    attachments: Attachment[],
    originalTotpCodeIds: string[] = [],
    totpCodes: TotpCode[] = []
  ): Promise<number> {
    const tree = this.vault.credentials[credential.Id];
    if (!tree) {
      throw new Error('Credential not found');
    }

    const ts = Date.now();

    tree.serviceName = credential.ServiceName;
    tree.serviceUrl = credential.ServiceUrl;
    if (credential.Logo) {
      tree.logo = toLogo(credential.Logo);
    }
    tree.username = credential.Username;
    tree.notes = credential.Notes;
    tree.updatedAt = ts;

    tree.alias = {
      firstName: credential.Alias.FirstName,
      lastName: credential.Alias.LastName,
      nickName: credential.Alias.NickName,
      birthDate: credential.Alias.BirthDate,
      gender: credential.Alias.Gender,
      email: credential.Alias.Email,
    };

    if (credential.Password !== tree.password.value) {
      tree.password = {
        value: credential.Password,
        createdAt: tree.password.createdAt,
        updatedAt: ts,
      };
    }

    // Soft-delete removed attachments
    const currentAttIds = (attachments ?? []).map(a => a.Id);
    for (const att of tree.attachments) {
      if (originalAttachmentIds.includes(att.id) && !currentAttIds.includes(att.id)) {
        att.isDeleted = true;
        att.updatedAt = ts;
      }
    }
    // Add new attachments
    for (const att of attachments ?? []) {
      if (!originalAttachmentIds.includes(att.Id)) {
        tree.attachments.push({
          id: att.Id,
          filename: att.Filename,
          blob: binaryToBase64(att.Blob),
          createdAt: ts,
          updatedAt: ts,
          isDeleted: false,
        });
      }
    }

    // Soft-delete removed TOTP codes
    const activeTotpIds = (totpCodes ?? []).filter(tc => !tc.IsDeleted).map(tc => tc.Id);
    for (const totp of tree.totpCodes) {
      if (originalTotpCodeIds.includes(totp.id) && !activeTotpIds.includes(totp.id)) {
        totp.isDeleted = true;
      }
    }
    // Mark explicitly deleted TOTP codes
    for (const tc of totpCodes ?? []) {
      if (tc.IsDeleted && originalTotpCodeIds.includes(tc.Id)) {
        const existing = tree.totpCodes.find(t => t.id === tc.Id);
        if (existing) {
          existing.isDeleted = true;
        }
      }
    }
    // Insert or update TOTP codes
    for (const tc of totpCodes ?? []) {
      if (tc.IsDeleted) {
        continue;
      }
      if (originalTotpCodeIds.includes(tc.Id)) {
        const existing = tree.totpCodes.find(t => t.id === tc.Id);
        if (existing) {
          existing.name = tc.Name;
          existing.secretKey = tc.SecretKey;
        }
      } else {
        tree.totpCodes.push({
          id: tc.Id || crypto.randomUUID().toUpperCase(),
          name: tc.Name,
          secretKey: tc.SecretKey,
          isDeleted: false,
        });
      }
    }

    return 1;
  }

  async deleteCredentialById(id: string): Promise<number> {
    const tree = this.vault.credentials[id];
    if (!tree) {
      return 0;
    }
    const ts = Date.now();
    tree.isDeleted = true;
    tree.updatedAt = ts;
    for (const pk of tree.passkeys) {
      pk.isDeleted = true;
      pk.updatedAt = Date.now();
    }
    return 1;
  }

  // --- Settings ---

  getSetting(key: string, defaultValue: string = ''): string {
    return this.vault.settings[key] ?? defaultValue;
  }

  setSetting(key: string, value: string): void {
    this.vault.settings[key] = value;
  }

  async getDefaultEmailDomain(): Promise<string | null> {
    const domain = this.getSetting('DefaultEmailDomain');
    return domain || null;
  }

  getDefaultIdentityLanguage(): string {
    return this.getSetting('DefaultIdentityLanguage');
  }

  async getEffectiveIdentityLanguage(): Promise<string> {
    return this.getSetting('DefaultIdentityLanguage') || 'en';
  }

  getDefaultIdentityGender(): string {
    return this.getSetting('DefaultIdentityGender', 'random');
  }

  getDefaultIdentityAgeRange(): string {
    return this.getSetting('DefaultIdentityAgeRange', 'random');
  }

  getPasswordSettings(): PasswordSettings {
    const settingsJson = this.getSetting('PasswordGenerationSettings');
    const defaults: PasswordSettings = {
      Length: 18,
      UseLowercase: true,
      UseUppercase: true,
      UseNumbers: true,
      UseSpecialChars: true,
      UseNonAmbiguousChars: false,
    };
    try {
      if (settingsJson) {
        return { ...defaults, ...JSON.parse(settingsJson) };
      }
    } catch {
      // use defaults
    }
    return defaults;
  }

  // --- Encryption Keys ---

  getAllEncryptionKeys(): EncryptionKey[] {
    return this.vault.encryptionKeys.map(ek => ({
      Id: ek.id,
      PublicKey: ek.publicKey,
      PrivateKey: ek.privateKey,
      IsPrimary: ek.isPrimary,
    }));
  }

  addEncryptionKey(key: EncryptionKey): void {
    if (this.vault.encryptionKeys.some(ek => ek.id === key.Id)) {
      return;
    }
    this.vault.encryptionKeys.push({
      id: key.Id,
      publicKey: key.PublicKey,
      privateKey: key.PrivateKey,
      isPrimary: key.IsPrimary,
    });
  }

  // --- Passkeys ---

  getPasskeysByRpId(rpId: string): Array<Passkey & { Username?: string | null; ServiceName?: string | null }> {
    const results: Array<Passkey & { Username?: string | null; ServiceName?: string | null }> = [];
    for (const tree of Object.values(this.vault.credentials)) {
      if (tree.isDeleted) {
        continue;
      }
      for (const pk of tree.passkeys) {
        if (pk.rpId === rpId && !pk.isDeleted) {
          results.push({
            ...this.entryToPasskey(pk),
            Username: tree.username ?? null,
            ServiceName: tree.serviceName ?? null,
          });
        }
      }
    }
    return results.sort((a, b) => b.CreatedAt - a.CreatedAt);
  }

  getPasskeyById(passkeyId: string): (Passkey & { Username?: string | null; ServiceName?: string | null }) | null {
    for (const tree of Object.values(this.vault.credentials)) {
      if (tree.isDeleted) {
        continue;
      }
      const pk = tree.passkeys.find(p => p.id === passkeyId && !p.isDeleted);
      if (pk) {
        return {
          ...this.entryToPasskey(pk),
          Username: tree.username ?? null,
          ServiceName: tree.serviceName ?? null,
        };
      }
    }
    return null;
  }

  getPasskeysByCredentialId(credentialId: string): Passkey[] {
    const tree = this.vault.credentials[credentialId];
    if (!tree) {
      return [];
    }
    return tree.passkeys
      .filter(pk => !pk.isDeleted)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(pk => this.entryToPasskey(pk));
  }

  async createPasskey(passkey: Omit<Passkey, 'CreatedAt' | 'UpdatedAt' | 'IsDeleted'>): Promise<void> {
    const tree = this.vault.credentials[passkey.CredentialId];
    if (!tree) {
      throw new Error('Credential not found');
    }
    const ts = Date.now();

    let userHandleB64: string | undefined;
    if (passkey.UserHandle) {
      const uh = passkey.UserHandle instanceof Uint8Array
        ? passkey.UserHandle
        : new Uint8Array(passkey.UserHandle as number[]);
      userHandleB64 = binaryToBase64(uh);
    }

    let prfKeyB64: string | undefined;
    if (passkey.PrfKey) {
      const pk = passkey.PrfKey instanceof Uint8Array
        ? passkey.PrfKey
        : new Uint8Array(passkey.PrfKey as number[]);
      prfKeyB64 = binaryToBase64(pk);
    }

    tree.passkeys.push({
      id: passkey.Id,
      credentialId: passkey.CredentialId,
      rpId: passkey.RpId,
      userHandle: userHandleB64,
      publicKey: passkey.PublicKey,
      privateKey: passkey.PrivateKey,
      prfKey: prfKeyB64,
      displayName: passkey.DisplayName,
      additionalData: passkey.AdditionalData ?? undefined,
      createdAt: ts,
      updatedAt: ts,
      isDeleted: false,
    });
  }

  async deletePasskeyById(passkeyId: string): Promise<number> {
    for (const tree of Object.values(this.vault.credentials)) {
      const pk = tree.passkeys.find(p => p.id === passkeyId);
      if (pk) {
        pk.isDeleted = true;
        pk.updatedAt = Date.now();
        return 1;
      }
    }
    return 0;
  }

  async deletePasskeysByCredentialId(credentialId: string): Promise<number> {
    const tree = this.vault.credentials[credentialId];
    if (!tree) {
      return 0;
    }
    let count = 0;
    const ts = Date.now();
    for (const pk of tree.passkeys) {
      if (!pk.isDeleted) {
        pk.isDeleted = true;
        pk.updatedAt = ts;
        count++;
      }
    }
    return count;
  }

  async updatePasskeyDisplayName(passkeyId: string, displayName: string): Promise<number> {
    for (const tree of Object.values(this.vault.credentials)) {
      const pk = tree.passkeys.find(p => p.id === passkeyId);
      if (pk) {
        pk.displayName = displayName;
        pk.updatedAt = Date.now();
        return 1;
      }
    }
    return 0;
  }

  // --- Attachments ---

  getAttachmentsForCredential(credentialId: string): Attachment[] {
    const tree = this.vault.credentials[credentialId];
    if (!tree) {
      return [];
    }
    return tree.attachments
      .filter(att => !att.isDeleted)
      .map(att => ({
        Id: att.id,
        Filename: att.filename,
        Blob: base64ToBinary(att.blob),
        CredentialId: credentialId,
        CreatedAt: new Date(att.createdAt).toISOString(),
        UpdatedAt: new Date(att.updatedAt).toISOString(),
      }));
  }

  // --- TOTP ---

  getTotpCodesForCredential(credentialId: string): TotpCode[] {
    const tree = this.vault.credentials[credentialId];
    if (!tree) {
      return [];
    }
    return tree.totpCodes
      .filter(tc => !tc.isDeleted)
      .map(tc => ({
        Id: tc.id,
        Name: tc.name,
        SecretKey: tc.secretKey,
        CredentialId: credentialId,
      }));
  }

  // --- Email ---

  getAllEmailAddresses(): string[] {
    const emails = new Set<string>();
    for (const tree of Object.values(this.vault.credentials)) {
      if (!tree.isDeleted && tree.alias.email) {
        emails.add(tree.alias.email);
      }
    }
    return Array.from(emails);
  }

  // --- Version & Migration ---

  async hasPendingMigrations(): Promise<boolean> {
    return false;
  }

  getDatabaseVersion(): number {
    return this.vault.version;
  }

  // --- Private helpers ---

  private treeToCredential(tree: CredentialTree): Credential {
    const activePasskeys = tree.passkeys.filter(pk => !pk.isDeleted);
    const activeAttachments = tree.attachments.filter(att => !att.isDeleted);
    return {
      Id: tree.id,
      Username: tree.username,
      Password: tree.password.value,
      ServiceName: tree.serviceName,
      ServiceUrl: tree.serviceUrl,
      Logo: tree.logo ? base64ToBinary(tree.logo) : undefined,
      Notes: tree.notes,
      HasPasskey: activePasskeys.length > 0,
      PasskeyRpId: activePasskeys[0]?.rpId,
      PasskeyDisplayName: activePasskeys[0]?.displayName,
      HasAttachment: activeAttachments.length > 0,
      Alias: {
        FirstName: tree.alias.firstName,
        LastName: tree.alias.lastName,
        NickName: tree.alias.nickName,
        BirthDate: tree.alias.birthDate,
        Gender: tree.alias.gender,
        Email: tree.alias.email,
      },
    };
  }

  private entryToPasskey(entry: CredentialTree['passkeys'][number]): Passkey {
    return {
      Id: entry.id,
      CredentialId: entry.credentialId,
      RpId: entry.rpId,
      UserHandle: entry.userHandle ? base64ToBinary(entry.userHandle) : undefined,
      PublicKey: entry.publicKey,
      PrivateKey: entry.privateKey,
      PrfKey: entry.prfKey ? base64ToBinary(entry.prfKey) : undefined,
      DisplayName: entry.displayName,
      AdditionalData: entry.additionalData,
      CreatedAt: entry.createdAt,
      UpdatedAt: entry.updatedAt,
      IsDeleted: entry.isDeleted ? 1 : 0,
    };
  }
}
