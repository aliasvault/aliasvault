var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// ../vault-types/dist/index.js
var require_dist = __commonJS({
  "../vault-types/dist/index.js"(exports, module) {
    "use strict";
    var __defProp2 = Object.defineProperty;
    var __getOwnPropDesc2 = Object.getOwnPropertyDescriptor;
    var __getOwnPropNames2 = Object.getOwnPropertyNames;
    var __hasOwnProp2 = Object.prototype.hasOwnProperty;
    var __export = (target, all) => {
      for (var name in all)
        __defProp2(target, name, { get: all[name], enumerable: true });
    };
    var __copyProps2 = (to, from, except, desc) => {
      if (from && typeof from === "object" || typeof from === "function") {
        for (let key of __getOwnPropNames2(from))
          if (!__hasOwnProp2.call(to, key) && key !== except)
            __defProp2(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc2(from, key)) || desc.enumerable });
      }
      return to;
    };
    var __toCommonJS = (mod) => __copyProps2(__defProp2({}, "__esModule", { value: true }), mod);
    var index_exports = {};
    __export(index_exports, {
      VaultStore: () => VaultStore,
      resolveVaultConflict: () => resolveVaultConflict2
    });
    module.exports = __toCommonJS(index_exports);
    var CURRENT_VERSION = 1;
    function binaryToBase64(data) {
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
      let binaryString = "";
      for (let i = 0; i < bytes.length; i++) {
        binaryString += String.fromCharCode(bytes[i]);
      }
      return btoa(binaryString);
    }
    function base64ToBinary(b64) {
      const binaryString = atob(b64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return bytes;
    }
    function toLogo(logo) {
      if (!logo) {
        return void 0;
      }
      if (typeof logo === "object" && !ArrayBuffer.isView(logo) && !Array.isArray(logo)) {
        const values = Object.values(logo);
        return binaryToBase64(new Uint8Array(values));
      }
      return binaryToBase64(logo);
    }
    var VaultStore = class _VaultStore {
      constructor(vault) {
        this.vault = vault;
      }
      // --- Lifecycle ---
      static fromJson(json) {
        const parsed = JSON.parse(json);
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
        return new _VaultStore(parsed);
      }
      toJson() {
        this.vault.version = CURRENT_VERSION;
        this.vault.lastModified = Date.now();
        return JSON.stringify(this.vault);
      }
      static createEmpty() {
        return new _VaultStore({
          version: CURRENT_VERSION,
          credentials: {},
          settings: {},
          encryptionKeys: []
        });
      }
      // --- Credential CRUD ---
      getAllCredentials() {
        return Object.values(this.vault.credentials).filter((tree) => !tree.isDeleted).sort((a, b) => b.createdAt - a.createdAt).map((tree) => this.treeToCredential(tree));
      }
      getCredentialById(id) {
        const tree = this.vault.credentials[id];
        if (!tree || tree.isDeleted) {
          return null;
        }
        return this.treeToCredential(tree);
      }
      async createCredential(credential, attachments, totpCodes = []) {
        const id = crypto.randomUUID().toUpperCase();
        const ts = Date.now();
        const tree = {
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
            email: credential.Alias.Email
          },
          attachments: (attachments ?? []).map((att) => ({
            id: crypto.randomUUID().toUpperCase(),
            filename: att.Filename,
            blob: binaryToBase64(att.Blob),
            createdAt: ts,
            updatedAt: ts,
            isDeleted: false
          })),
          totpCodes: (totpCodes ?? []).filter((tc) => !tc.IsDeleted).map((tc) => ({
            id: tc.Id || crypto.randomUUID().toUpperCase(),
            name: tc.Name,
            secretKey: tc.SecretKey,
            isDeleted: false
          })),
          passkeys: [],
          createdAt: ts,
          updatedAt: ts,
          isDeleted: false
        };
        this.vault.credentials[id] = tree;
        return id;
      }
      async updateCredentialById(credential, originalAttachmentIds, attachments, originalTotpCodeIds = [], totpCodes = []) {
        const tree = this.vault.credentials[credential.Id];
        if (!tree) {
          throw new Error("Credential not found");
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
          email: credential.Alias.Email
        };
        if (credential.Password !== tree.password.value) {
          tree.password = {
            value: credential.Password,
            createdAt: tree.password.createdAt,
            updatedAt: ts
          };
        }
        const currentAttIds = (attachments ?? []).map((a) => a.Id);
        for (const att of tree.attachments) {
          if (originalAttachmentIds.includes(att.id) && !currentAttIds.includes(att.id)) {
            att.isDeleted = true;
            att.updatedAt = ts;
          }
        }
        for (const att of attachments ?? []) {
          if (!originalAttachmentIds.includes(att.Id)) {
            tree.attachments.push({
              id: att.Id,
              filename: att.Filename,
              blob: binaryToBase64(att.Blob),
              createdAt: ts,
              updatedAt: ts,
              isDeleted: false
            });
          }
        }
        const activeTotpIds = (totpCodes ?? []).filter((tc) => !tc.IsDeleted).map((tc) => tc.Id);
        for (const totp of tree.totpCodes) {
          if (originalTotpCodeIds.includes(totp.id) && !activeTotpIds.includes(totp.id)) {
            totp.isDeleted = true;
          }
        }
        for (const tc of totpCodes ?? []) {
          if (tc.IsDeleted && originalTotpCodeIds.includes(tc.Id)) {
            const existing = tree.totpCodes.find((t) => t.id === tc.Id);
            if (existing) {
              existing.isDeleted = true;
            }
          }
        }
        for (const tc of totpCodes ?? []) {
          if (tc.IsDeleted) {
            continue;
          }
          if (originalTotpCodeIds.includes(tc.Id)) {
            const existing = tree.totpCodes.find((t) => t.id === tc.Id);
            if (existing) {
              existing.name = tc.Name;
              existing.secretKey = tc.SecretKey;
            }
          } else {
            tree.totpCodes.push({
              id: tc.Id || crypto.randomUUID().toUpperCase(),
              name: tc.Name,
              secretKey: tc.SecretKey,
              isDeleted: false
            });
          }
        }
        return 1;
      }
      async deleteCredentialById(id) {
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
      getSetting(key, defaultValue = "") {
        return this.vault.settings[key] ?? defaultValue;
      }
      setSetting(key, value) {
        this.vault.settings[key] = value;
      }
      async getDefaultEmailDomain() {
        const domain = this.getSetting("DefaultEmailDomain");
        return domain || null;
      }
      getDefaultIdentityLanguage() {
        return this.getSetting("DefaultIdentityLanguage");
      }
      async getEffectiveIdentityLanguage() {
        return this.getSetting("DefaultIdentityLanguage") || "en";
      }
      getDefaultIdentityGender() {
        return this.getSetting("DefaultIdentityGender", "random");
      }
      getDefaultIdentityAgeRange() {
        return this.getSetting("DefaultIdentityAgeRange", "random");
      }
      getPasswordSettings() {
        const settingsJson = this.getSetting("PasswordGenerationSettings");
        const defaults = {
          Length: 18,
          UseLowercase: true,
          UseUppercase: true,
          UseNumbers: true,
          UseSpecialChars: true,
          UseNonAmbiguousChars: false
        };
        try {
          if (settingsJson) {
            return { ...defaults, ...JSON.parse(settingsJson) };
          }
        } catch {
        }
        return defaults;
      }
      // --- Encryption Keys ---
      getAllEncryptionKeys() {
        return this.vault.encryptionKeys.map((ek) => ({
          Id: ek.id,
          PublicKey: ek.publicKey,
          PrivateKey: ek.privateKey,
          IsPrimary: ek.isPrimary
        }));
      }
      addEncryptionKey(key) {
        if (this.vault.encryptionKeys.some((ek) => ek.id === key.Id)) {
          return;
        }
        this.vault.encryptionKeys.push({
          id: key.Id,
          publicKey: key.PublicKey,
          privateKey: key.PrivateKey,
          isPrimary: key.IsPrimary
        });
      }
      // --- Passkeys ---
      getPasskeysByRpId(rpId) {
        const results = [];
        for (const tree of Object.values(this.vault.credentials)) {
          if (tree.isDeleted) {
            continue;
          }
          for (const pk of tree.passkeys) {
            if (pk.rpId === rpId && !pk.isDeleted) {
              results.push({
                ...this.entryToPasskey(pk),
                Username: tree.username ?? null,
                ServiceName: tree.serviceName ?? null
              });
            }
          }
        }
        return results.sort((a, b) => b.CreatedAt - a.CreatedAt);
      }
      getPasskeyById(passkeyId) {
        for (const tree of Object.values(this.vault.credentials)) {
          if (tree.isDeleted) {
            continue;
          }
          const pk = tree.passkeys.find((p) => p.id === passkeyId && !p.isDeleted);
          if (pk) {
            return {
              ...this.entryToPasskey(pk),
              Username: tree.username ?? null,
              ServiceName: tree.serviceName ?? null
            };
          }
        }
        return null;
      }
      getPasskeysByCredentialId(credentialId) {
        const tree = this.vault.credentials[credentialId];
        if (!tree) {
          return [];
        }
        return tree.passkeys.filter((pk) => !pk.isDeleted).sort((a, b) => b.createdAt - a.createdAt).map((pk) => this.entryToPasskey(pk));
      }
      async createPasskey(passkey) {
        const tree = this.vault.credentials[passkey.CredentialId];
        if (!tree) {
          throw new Error("Credential not found");
        }
        const ts = Date.now();
        let userHandleB64;
        if (passkey.UserHandle) {
          const uh = passkey.UserHandle instanceof Uint8Array ? passkey.UserHandle : new Uint8Array(passkey.UserHandle);
          userHandleB64 = binaryToBase64(uh);
        }
        let prfKeyB64;
        if (passkey.PrfKey) {
          const pk = passkey.PrfKey instanceof Uint8Array ? passkey.PrfKey : new Uint8Array(passkey.PrfKey);
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
          additionalData: passkey.AdditionalData ?? void 0,
          createdAt: ts,
          updatedAt: ts,
          isDeleted: false
        });
      }
      async deletePasskeyById(passkeyId) {
        for (const tree of Object.values(this.vault.credentials)) {
          const pk = tree.passkeys.find((p) => p.id === passkeyId);
          if (pk) {
            pk.isDeleted = true;
            pk.updatedAt = Date.now();
            return 1;
          }
        }
        return 0;
      }
      async deletePasskeysByCredentialId(credentialId) {
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
      async updatePasskeyDisplayName(passkeyId, displayName) {
        for (const tree of Object.values(this.vault.credentials)) {
          const pk = tree.passkeys.find((p) => p.id === passkeyId);
          if (pk) {
            pk.displayName = displayName;
            pk.updatedAt = Date.now();
            return 1;
          }
        }
        return 0;
      }
      // --- Attachments ---
      getAttachmentsForCredential(credentialId) {
        const tree = this.vault.credentials[credentialId];
        if (!tree) {
          return [];
        }
        return tree.attachments.filter((att) => !att.isDeleted).map((att) => ({
          Id: att.id,
          Filename: att.filename,
          Blob: base64ToBinary(att.blob),
          CredentialId: credentialId,
          CreatedAt: new Date(att.createdAt).toISOString(),
          UpdatedAt: new Date(att.updatedAt).toISOString()
        }));
      }
      // --- TOTP ---
      getTotpCodesForCredential(credentialId) {
        const tree = this.vault.credentials[credentialId];
        if (!tree) {
          return [];
        }
        return tree.totpCodes.filter((tc) => !tc.isDeleted).map((tc) => ({
          Id: tc.id,
          Name: tc.name,
          SecretKey: tc.secretKey,
          CredentialId: credentialId
        }));
      }
      // --- Email ---
      getAllEmailAddresses() {
        const emails = /* @__PURE__ */ new Set();
        for (const tree of Object.values(this.vault.credentials)) {
          if (!tree.isDeleted && tree.alias.email) {
            emails.add(tree.alias.email);
          }
        }
        return Array.from(emails);
      }
      // --- Version & Migration ---
      async hasPendingMigrations() {
        return false;
      }
      getDatabaseVersion() {
        return this.vault.version;
      }
      // --- Private helpers ---
      treeToCredential(tree) {
        const activePasskeys = tree.passkeys.filter((pk) => !pk.isDeleted);
        const activeAttachments = tree.attachments.filter((att) => !att.isDeleted);
        return {
          Id: tree.id,
          Username: tree.username,
          Password: tree.password.value,
          ServiceName: tree.serviceName,
          ServiceUrl: tree.serviceUrl,
          Logo: tree.logo ? base64ToBinary(tree.logo) : void 0,
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
            Email: tree.alias.email
          }
        };
      }
      entryToPasskey(entry) {
        return {
          Id: entry.id,
          CredentialId: entry.credentialId,
          RpId: entry.rpId,
          UserHandle: entry.userHandle ? base64ToBinary(entry.userHandle) : void 0,
          PublicKey: entry.publicKey,
          PrivateKey: entry.privateKey,
          PrfKey: entry.prfKey ? base64ToBinary(entry.prfKey) : void 0,
          DisplayName: entry.displayName,
          AdditionalData: entry.additionalData,
          CreatedAt: entry.createdAt,
          UpdatedAt: entry.updatedAt,
          IsDeleted: entry.isDeleted ? 1 : 0
        };
      }
    };
    function resolveVaultConflict2(local, remote) {
      const merged = {};
      const summary = { added: [], updated: [], deleted: [], kept: [] };
      const allIds = /* @__PURE__ */ new Set([
        ...Object.keys(local.credentials),
        ...Object.keys(remote.credentials)
      ]);
      for (const id of allIds) {
        const localCred = local.credentials[id];
        const remoteCred = remote.credentials[id];
        if (!localCred) {
          merged[id] = remoteCred;
          summary.added.push(id);
        } else if (!remoteCred) {
          merged[id] = localCred;
          summary.kept.push(id);
        } else {
          if (remoteCred.updatedAt > localCred.updatedAt) {
            merged[id] = remoteCred;
            summary.updated.push(id);
          } else {
            merged[id] = localCred;
            summary.kept.push(id);
          }
        }
      }
      const deletedBothSides = /* @__PURE__ */ new Set();
      for (const id of allIds) {
        const inBoth = local.credentials[id] && remote.credentials[id];
        if (inBoth && merged[id].isDeleted) {
          deletedBothSides.add(id);
        }
      }
      if (deletedBothSides.size > 0) {
        summary.updated = summary.updated.filter((x) => !deletedBothSides.has(x));
        summary.kept = summary.kept.filter((x) => !deletedBothSides.has(x));
        for (const id of deletedBothSides) {
          summary.deleted.push(id);
        }
      }
      const mergedSettings = { ...local.settings, ...remote.settings };
      const keyMap = new Map(local.encryptionKeys.map((k) => [k.id, k]));
      for (const rk of remote.encryptionKeys) {
        keyMap.set(rk.id, rk);
      }
      return {
        merged: {
          version: Math.max(local.version, remote.version),
          credentials: merged,
          settings: mergedSettings,
          encryptionKeys: [...keyMap.values()],
          lastModified: Date.now()
        },
        summary
      };
    }
  }
});

// src/crypto-shim.js
var require_crypto_shim = __commonJS({
  "src/crypto-shim.js"(exports, module) {
    "use strict";
    module.exports = globalThis.crypto;
  }
});

// ../../node_modules/.pnpm/secrets.js-34r7h@2.0.2/node_modules/secrets.js-34r7h/secrets.js
var require_secrets = __commonJS({
  "../../node_modules/.pnpm/secrets.js-34r7h@2.0.2/node_modules/secrets.js-34r7h/secrets.js"(exports, module) {
    "use strict";
    (function(root, factory) {
      "use strict";
      if (typeof define === "function" && define.amd) {
        define([], function() {
          return root.secrets = factory(window.crypto);
        });
      } else if (typeof exports === "object") {
        module.exports = factory(require_crypto_shim());
      } else {
        root.secrets = factory(root.crypto);
      }
    })(exports, function(crypto2) {
      "use strict";
      var defaults, config, preGenPadding, runCSPRNGTest, CSPRNGTypes;
      function reset() {
        defaults = {
          bits: 8,
          // default number of bits
          radix: 16,
          // work with HEX by default
          minBits: 3,
          maxBits: 20,
          // this permits 1,048,575 shares, though going this high is NOT recommended in JS!
          bytesPerChar: 2,
          maxBytesPerChar: 6,
          // Math.pow(256,7) > Math.pow(2,53)
          // Primitive polynomials (in decimal form) for Galois Fields GF(2^n), for 2 <= n <= 30
          // The index of each term in the array corresponds to the n for that polynomial
          // i.e. to get the polynomial for n=16, use primitivePolynomials[16]
          primitivePolynomials: [
            null,
            null,
            1,
            3,
            3,
            5,
            3,
            3,
            29,
            17,
            9,
            5,
            83,
            27,
            43,
            3,
            45,
            9,
            39,
            39,
            9,
            5,
            3,
            33,
            27,
            9,
            71,
            39,
            9,
            5,
            83
          ]
        };
        config = {};
        preGenPadding = new Array(1024).join("0");
        runCSPRNGTest = true;
        CSPRNGTypes = [
          "nodeCryptoRandomBytes",
          "browserCryptoGetRandomValues",
          "testRandom"
        ];
      }
      function isSetRNG() {
        if (config && config.rng && typeof config.rng === "function") {
          return true;
        }
        return false;
      }
      function padLeft(str, multipleOfBits) {
        var missing;
        if (multipleOfBits === 0 || multipleOfBits === 1) {
          return str;
        }
        if (multipleOfBits && multipleOfBits > 1024) {
          throw new Error(
            "Padding must be multiples of no larger than 1024 bits."
          );
        }
        multipleOfBits = multipleOfBits || config.bits;
        if (str) {
          missing = str.length % multipleOfBits;
        }
        if (missing) {
          return (preGenPadding + str).slice(
            -(multipleOfBits - missing + str.length)
          );
        }
        return str;
      }
      function hex2bin(str) {
        var bin = "", num, i;
        for (i = str.length - 1; i >= 0; i--) {
          num = parseInt(str[i], 16);
          if (isNaN(num)) {
            throw new Error("Invalid hex character.");
          }
          bin = padLeft(num.toString(2), 4) + bin;
        }
        return bin;
      }
      function bin2hex(str) {
        var hex = "", num, i;
        str = padLeft(str, 4);
        for (i = str.length; i >= 4; i -= 4) {
          num = parseInt(str.slice(i - 4, i), 2);
          if (isNaN(num)) {
            throw new Error("Invalid binary character.");
          }
          hex = num.toString(16) + hex;
        }
        return hex;
      }
      function hasCryptoGetRandomValues() {
        if (crypto2 && typeof crypto2 === "object" && (typeof crypto2.getRandomValues === "function" || typeof crypto2.getRandomValues === "object") && (typeof Uint32Array === "function" || typeof Uint32Array === "object")) {
          return true;
        }
        return false;
      }
      function hasCryptoRandomBytes() {
        if (typeof crypto2 === "object" && typeof crypto2.randomBytes === "function") {
          return true;
        }
        return false;
      }
      function getRNG(type) {
        function construct(bits, arr, radix, size) {
          var i = 0, len, str = "", parsedInt;
          if (arr) {
            len = arr.length - 1;
          }
          while (i < len || str.length < bits) {
            parsedInt = Math.abs(parseInt(arr[i], radix));
            str = str + padLeft(parsedInt.toString(2), size);
            i++;
          }
          str = str.substr(-bits);
          if ((str.match(/0/g) || []).length === str.length) {
            return null;
          }
          return str;
        }
        function nodeCryptoRandomBytes(bits) {
          var buf, bytes, radix, size, str = null;
          radix = 16;
          size = 4;
          bytes = Math.ceil(bits / 8);
          while (str === null) {
            buf = crypto2.randomBytes(bytes);
            str = construct(bits, buf.toString("hex"), radix, size);
          }
          return str;
        }
        function browserCryptoGetRandomValues(bits) {
          var elems, radix, size, str = null;
          radix = 10;
          size = 32;
          elems = Math.ceil(bits / 32);
          while (str === null) {
            str = construct(
              bits,
              crypto2.getRandomValues(new Uint32Array(elems)),
              radix,
              size
            );
          }
          return str;
        }
        function testRandom(bits) {
          var arr, elems, int, radix, size, str = null;
          radix = 10;
          size = 32;
          elems = Math.ceil(bits / 32);
          int = 123456789;
          arr = new Uint32Array(elems);
          for (var i = 0; i < arr.length; i++) {
            arr[i] = int;
          }
          while (str === null) {
            str = construct(bits, arr, radix, size);
          }
          return str;
        }
        if (type && type === "testRandom") {
          config.typeCSPRNG = type;
          return testRandom;
        } else if (type && type === "nodeCryptoRandomBytes") {
          config.typeCSPRNG = type;
          return nodeCryptoRandomBytes;
        } else if (type && type === "browserCryptoGetRandomValues") {
          config.typeCSPRNG = type;
          return browserCryptoGetRandomValues;
        } else if (hasCryptoRandomBytes()) {
          config.typeCSPRNG = "nodeCryptoRandomBytes";
          return nodeCryptoRandomBytes;
        } else if (hasCryptoGetRandomValues()) {
          config.typeCSPRNG = "browserCryptoGetRandomValues";
          return browserCryptoGetRandomValues;
        }
      }
      function splitNumStringToIntArray(str, padLength) {
        var parts = [], i;
        if (padLength) {
          str = padLeft(str, padLength);
        }
        for (i = str.length; i > config.bits; i -= config.bits) {
          parts.push(parseInt(str.slice(i - config.bits, i), 2));
        }
        parts.push(parseInt(str.slice(0, i), 2));
        return parts;
      }
      function horner(x, coeffs) {
        var logx = config.logs[x], fx = 0, i;
        for (i = coeffs.length - 1; i >= 0; i--) {
          if (fx !== 0) {
            fx = config.exps[(logx + config.logs[fx]) % config.maxShares] ^ coeffs[i];
          } else {
            fx = coeffs[i];
          }
        }
        return fx;
      }
      function lagrange(at, x, y) {
        var sum = 0, len, product, i, j;
        for (i = 0, len = x.length; i < len; i++) {
          if (y[i]) {
            product = config.logs[y[i]];
            for (j = 0; j < len; j++) {
              if (i !== j) {
                if (at === x[j]) {
                  product = -1;
                  break;
                }
                product = (product + config.logs[at ^ x[j]] - config.logs[x[i] ^ x[j]] + config.maxShares) % config.maxShares;
              }
            }
            sum = product === -1 ? sum : sum ^ config.exps[product];
          }
        }
        return sum;
      }
      function getShares(secret, numShares, threshold) {
        var shares = [], coeffs = [secret], i, len;
        for (i = 1; i < threshold; i++) {
          coeffs[i] = parseInt(config.rng(config.bits), 2);
        }
        for (i = 1, len = numShares + 1; i < len; i++) {
          shares[i - 1] = {
            x: i,
            y: horner(i, coeffs)
          };
        }
        return shares;
      }
      function constructPublicShareString(bits, id, data) {
        var bitsBase36, idHex, idMax, idPaddingLen, newShareString;
        id = parseInt(id, config.radix);
        bits = parseInt(bits, 10) || config.bits;
        bitsBase36 = bits.toString(36).toUpperCase();
        idMax = Math.pow(2, bits) - 1;
        idPaddingLen = idMax.toString(config.radix).length;
        idHex = padLeft(id.toString(config.radix), idPaddingLen);
        if (typeof id !== "number" || id % 1 !== 0 || id < 1 || id > idMax) {
          throw new Error(
            "Share id must be an integer between 1 and " + idMax + ", inclusive."
          );
        }
        newShareString = bitsBase36 + idHex + data;
        return newShareString;
      }
      var secrets2 = {
        init: function(bits, rngType) {
          var logs = [], exps = [], x = 1, primitive, i;
          reset();
          if (bits && (typeof bits !== "number" || bits % 1 !== 0 || bits < defaults.minBits || bits > defaults.maxBits)) {
            throw new Error(
              "Number of bits must be an integer between " + defaults.minBits + " and " + defaults.maxBits + ", inclusive."
            );
          }
          if (rngType && CSPRNGTypes.indexOf(rngType) === -1) {
            throw new Error("Invalid RNG type argument : '" + rngType + "'");
          }
          config.radix = defaults.radix;
          config.bits = bits || defaults.bits;
          config.size = Math.pow(2, config.bits);
          config.maxShares = config.size - 1;
          primitive = defaults.primitivePolynomials[config.bits];
          for (i = 0; i < config.size; i++) {
            exps[i] = x;
            logs[x] = i;
            x = x << 1;
            if (x >= config.size) {
              x = x ^ primitive;
              x = x & config.maxShares;
            }
          }
          config.logs = logs;
          config.exps = exps;
          if (rngType) {
            this.setRNG(rngType);
          }
          if (!isSetRNG()) {
            this.setRNG();
          }
          if (!isSetRNG() || !config.bits || !config.size || !config.maxShares || !config.logs || !config.exps || config.logs.length !== config.size || config.exps.length !== config.size) {
            throw new Error("Initialization failed.");
          }
        },
        // Evaluates the Lagrange interpolation polynomial at x=`at` for
        // individual config.bits-length segments of each share in the `shares`
        // Array. Each share is expressed in base `inputRadix`. The output
        // is expressed in base `outputRadix'.
        combine: function(shares, at) {
          var i, j, len, len2, result = "", setBits, share2, splitShare, x = [], y = [];
          at = at || 0;
          for (i = 0, len = shares.length; i < len; i++) {
            share2 = this.extractShareComponents(shares[i]);
            if (setBits === void 0) {
              setBits = share2.bits;
            } else if (share2.bits !== setBits) {
              throw new Error(
                "Mismatched shares: Different bit settings."
              );
            }
            if (config.bits !== setBits) {
              this.init(setBits);
            }
            if (x.indexOf(share2.id) === -1) {
              x.push(share2.id);
              splitShare = splitNumStringToIntArray(hex2bin(share2.data));
              for (j = 0, len2 = splitShare.length; j < len2; j++) {
                y[j] = y[j] || [];
                y[j][x.length - 1] = splitShare[j];
              }
            }
          }
          for (i = 0, len = y.length; i < len; i++) {
            result = padLeft(lagrange(at, x, y[i]).toString(2)) + result;
          }
          return bin2hex(
            at >= 1 ? result : result.slice(result.indexOf("1") + 1)
          );
        },
        getConfig: function() {
          var obj = {};
          obj.radix = config.radix;
          obj.bits = config.bits;
          obj.maxShares = config.maxShares;
          obj.hasCSPRNG = isSetRNG();
          obj.typeCSPRNG = config.typeCSPRNG;
          return obj;
        },
        // Given a public share, extract the bits (Integer), share ID (Integer), and share data (Hex)
        // and return an Object containing those components.
        extractShareComponents: function(share2) {
          var bits, id, idLen, max, obj = {}, regexStr, shareComponents;
          bits = parseInt(share2.substr(0, 1), 36);
          if (bits && (typeof bits !== "number" || bits % 1 !== 0 || bits < defaults.minBits || bits > defaults.maxBits)) {
            throw new Error(
              "Invalid share : Number of bits must be an integer between " + defaults.minBits + " and " + defaults.maxBits + ", inclusive."
            );
          }
          max = Math.pow(2, bits) - 1;
          idLen = (Math.pow(2, bits) - 1).toString(config.radix).length;
          regexStr = "^([a-kA-K3-9]{1})([a-fA-F0-9]{" + idLen + "})([a-fA-F0-9]+)$";
          shareComponents = new RegExp(regexStr).exec(share2);
          if (shareComponents) {
            id = parseInt(shareComponents[2], config.radix);
          }
          if (typeof id !== "number" || id % 1 !== 0 || id < 1 || id > max) {
            throw new Error(
              "Invalid share : Share id must be an integer between 1 and " + config.maxShares + ", inclusive."
            );
          }
          if (shareComponents && shareComponents[3]) {
            obj.bits = bits;
            obj.id = id;
            obj.data = shareComponents[3];
            return obj;
          }
          throw new Error("The share data provided is invalid : " + share2);
        },
        // Set the PRNG to use. If no RNG function is supplied, pick a default using getRNG()
        setRNG: function(rng) {
          var errPrefix = "Random number generator is invalid ", errSuffix = " Supply an CSPRNG of the form function(bits){} that returns a string containing 'bits' number of random 1's and 0's.";
          if (rng && typeof rng === "string" && CSPRNGTypes.indexOf(rng) === -1) {
            throw new Error("Invalid RNG type argument : '" + rng + "'");
          }
          if (!rng) {
            rng = getRNG();
          }
          if (rng && typeof rng === "string") {
            rng = getRNG(rng);
          }
          if (runCSPRNGTest) {
            if (rng && typeof rng !== "function") {
              throw new Error(errPrefix + "(Not a function)." + errSuffix);
            }
            if (rng && typeof rng(config.bits) !== "string") {
              throw new Error(
                errPrefix + "(Output is not a string)." + errSuffix
              );
            }
            if (rng && !parseInt(rng(config.bits), 2)) {
              throw new Error(
                errPrefix + "(Binary string output not parseable to an Integer)." + errSuffix
              );
            }
            if (rng && rng(config.bits).length > config.bits) {
              throw new Error(
                errPrefix + "(Output length is greater than config.bits)." + errSuffix
              );
            }
            if (rng && rng(config.bits).length < config.bits) {
              throw new Error(
                errPrefix + "(Output length is less than config.bits)." + errSuffix
              );
            }
          }
          config.rng = rng;
          return true;
        },
        // Converts a given UTF16 character string to the HEX representation.
        // Each character of the input string is represented by
        // `bytesPerChar` bytes in the output string which defaults to 2.
        str2hex: function(str, bytesPerChar) {
          var hexChars, max, out = "", neededBytes, num, i, len;
          if (typeof str !== "string") {
            throw new Error("Input must be a character string.");
          }
          if (!bytesPerChar) {
            bytesPerChar = defaults.bytesPerChar;
          }
          if (typeof bytesPerChar !== "number" || bytesPerChar < 1 || bytesPerChar > defaults.maxBytesPerChar || bytesPerChar % 1 !== 0) {
            throw new Error(
              "Bytes per character must be an integer between 1 and " + defaults.maxBytesPerChar + ", inclusive."
            );
          }
          hexChars = 2 * bytesPerChar;
          max = Math.pow(16, hexChars) - 1;
          for (i = 0, len = str.length; i < len; i++) {
            num = str[i].charCodeAt();
            if (isNaN(num)) {
              throw new Error("Invalid character: " + str[i]);
            }
            if (num > max) {
              neededBytes = Math.ceil(Math.log(num + 1) / Math.log(256));
              throw new Error(
                "Invalid character code (" + num + "). Maximum allowable is 256^bytes-1 (" + max + "). To convert this character, use at least " + neededBytes + " bytes."
              );
            }
            out = padLeft(num.toString(16), hexChars) + out;
          }
          return out;
        },
        // Converts a given HEX number string to a UTF16 character string.
        hex2str: function(str, bytesPerChar) {
          var hexChars, out = "", i, len;
          if (typeof str !== "string") {
            throw new Error("Input must be a hexadecimal string.");
          }
          bytesPerChar = bytesPerChar || defaults.bytesPerChar;
          if (typeof bytesPerChar !== "number" || bytesPerChar % 1 !== 0 || bytesPerChar < 1 || bytesPerChar > defaults.maxBytesPerChar) {
            throw new Error(
              "Bytes per character must be an integer between 1 and " + defaults.maxBytesPerChar + ", inclusive."
            );
          }
          hexChars = 2 * bytesPerChar;
          str = padLeft(str, hexChars);
          for (i = 0, len = str.length; i < len; i += hexChars) {
            out = String.fromCharCode(
              parseInt(str.slice(i, i + hexChars), 16)
            ) + out;
          }
          return out;
        },
        // Generates a random bits-length number string using the PRNG
        random: function(bits) {
          if (typeof bits !== "number" || bits % 1 !== 0 || bits < 2 || bits > 65536) {
            throw new Error(
              "Number of bits must be an Integer between 1 and 65536."
            );
          }
          return bin2hex(config.rng(bits));
        },
        // Divides a `secret` number String str expressed in radix `inputRadix` (optional, default 16)
        // into `numShares` shares, each expressed in radix `outputRadix` (optional, default to `inputRadix`),
        // requiring `threshold` number of shares to reconstruct the secret.
        // Optionally, zero-pads the secret to a length that is a multiple of padLength before sharing.
        share: function(secret, numShares, threshold, padLength) {
          var neededBits, subShares, x = new Array(numShares), y = new Array(numShares), i, j, len;
          padLength = padLength || 128;
          if (typeof secret !== "string") {
            throw new Error("Secret must be a string.");
          }
          if (typeof numShares !== "number" || numShares % 1 !== 0 || numShares < 2) {
            throw new Error(
              "Number of shares must be an integer between 2 and 2^bits-1 (" + config.maxShares + "), inclusive."
            );
          }
          if (numShares > config.maxShares) {
            neededBits = Math.ceil(Math.log(numShares + 1) / Math.LN2);
            throw new Error(
              "Number of shares must be an integer between 2 and 2^bits-1 (" + config.maxShares + "), inclusive. To create " + numShares + " shares, use at least " + neededBits + " bits."
            );
          }
          if (typeof threshold !== "number" || threshold % 1 !== 0 || threshold < 2) {
            throw new Error(
              "Threshold number of shares must be an integer between 2 and 2^bits-1 (" + config.maxShares + "), inclusive."
            );
          }
          if (threshold > config.maxShares) {
            neededBits = Math.ceil(Math.log(threshold + 1) / Math.LN2);
            throw new Error(
              "Threshold number of shares must be an integer between 2 and 2^bits-1 (" + config.maxShares + "), inclusive.  To use a threshold of " + threshold + ", use at least " + neededBits + " bits."
            );
          }
          if (threshold > numShares) {
            throw new Error(
              "Threshold number of shares was " + threshold + " but must be less than or equal to the " + numShares + " shares specified as the total to generate."
            );
          }
          if (typeof padLength !== "number" || padLength % 1 !== 0 || padLength < 0 || padLength > 1024) {
            throw new Error(
              "Zero-pad length must be an integer between 0 and 1024 inclusive."
            );
          }
          secret = "1" + hex2bin(secret);
          secret = splitNumStringToIntArray(secret, padLength);
          for (i = 0, len = secret.length; i < len; i++) {
            subShares = getShares(secret[i], numShares, threshold);
            for (j = 0; j < numShares; j++) {
              x[j] = x[j] || subShares[j].x.toString(config.radix);
              y[j] = padLeft(subShares[j].y.toString(2)) + (y[j] || "");
            }
          }
          for (i = 0; i < numShares; i++) {
            x[i] = constructPublicShareString(
              config.bits,
              x[i],
              bin2hex(y[i])
            );
          }
          return x;
        },
        // Generate a new share with id `id` (a number between 1 and 2^bits-1)
        // `id` can be a Number or a String in the default radix (16)
        newShare: function(id, shares) {
          var share2, radid;
          if (id && typeof id === "string") {
            id = parseInt(id, config.radix);
          }
          radid = id.toString(config.radix);
          if (id && radid && shares && shares[0]) {
            share2 = this.extractShareComponents(shares[0]);
            return constructPublicShareString(
              share2.bits,
              radid,
              this.combine(shares, id)
            );
          }
          throw new Error(
            "Invalid 'id' or 'shares' Array argument to newShare()."
          );
        },
        /* test-code */
        // export private functions so they can be unit tested directly.
        _reset: reset,
        _padLeft: padLeft,
        _hex2bin: hex2bin,
        _bin2hex: bin2hex,
        _hasCryptoGetRandomValues: hasCryptoGetRandomValues,
        _hasCryptoRandomBytes: hasCryptoRandomBytes,
        _getRNG: getRNG,
        _isSetRNG: isSetRNG,
        _splitNumStringToIntArray: splitNumStringToIntArray,
        _horner: horner,
        _lagrange: lagrange,
        _getShares: getShares,
        _constructPublicShareString: constructPublicShareString
        /* end-test-code */
      };
      secrets2.init();
      return secrets2;
    });
  }
});

// src/errors.ts
var VaultSyncErrorCodes = {
  IPFS_UPLOAD_FAILED: "VAULT_SYNC_IPFS_UPLOAD_FAILED",
  CONTRACT_UPDATE_FAILED: "VAULT_SYNC_CONTRACT_UPDATE_FAILED",
  CID_PERSISTENCE_FAILED: "VAULT_SYNC_CID_PERSISTENCE_FAILED",
  WALLET_NOT_CONNECTED: "VAULT_SYNC_WALLET_NOT_CONNECTED",
  INVALID_ENCRYPTED_DATA: "VAULT_SYNC_INVALID_ENCRYPTED_DATA",
  VAULT_NOT_FOUND: "VAULT_SYNC_VAULT_NOT_FOUND",
  CID_DISCOVERY_FAILED: "VAULT_SYNC_CID_DISCOVERY_FAILED",
  IPFS_DOWNLOAD_FAILED: "VAULT_SYNC_IPFS_DOWNLOAD_FAILED",
  LEDGER_READ_FAILED: "VAULT_SYNC_LEDGER_READ_FAILED",
  MERGE_DECRYPT_FAILED: "VAULT_SYNC_MERGE_DECRYPT_FAILED",
  MERGE_FAILED: "VAULT_SYNC_MERGE_FAILED",
  ENCRYPT_FAILED: "VAULT_SYNC_ENCRYPT_FAILED"
};
var VaultSyncError = class extends Error {
  constructor(code, message, retryable, cause) {
    super(message);
    this.name = "VaultSyncError";
    this.code = code;
    this.retryable = retryable;
    this.cause = cause;
  }
};

// src/utils.ts
function base64ToUint8Array(base64) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}
function uint8ArrayToBase64(bytes) {
  let binaryString = "";
  for (let i = 0; i < bytes.length; i++) {
    binaryString += String.fromCharCode(bytes[i]);
  }
  return btoa(binaryString);
}
async function sha256(data) {
  const encoder = new TextEncoder();
  const buffer = await crypto.subtle.digest("SHA-256", encoder.encode(data));
  return new Uint8Array(buffer);
}
function bytesToHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function hexToUint8Array(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

// src/VaultSyncService.ts
var import_vault_types = __toESM(require_dist());
var VaultSyncService = class {
  constructor(provider) {
    this.provider = provider ?? null;
  }
  /**
   * Load the latest vault from the blockchain + IPFS pipeline.
   *
   * Flow:
   * 1. Read vaultCidHash from on-chain public ledger
   * 2. Compare with locally cached cidHash
   * 3. If same → vault is up to date, return null
   * 4. If different → resolve CID (local cache or Pinata discovery) → download from IPFS
   * 5. Persist new CID + cidHash locally
   *
   * @returns VaultLoadResult with encrypted bytes, or null if vault is up to date
   * @throws VaultSyncError with VAULT_NOT_FOUND if no registration on-chain
   */
  async loadVault(loadProvider) {
    let onChainCidHash;
    try {
      onChainCidHash = await loadProvider.readContractCidHash();
    } catch (error) {
      throw new VaultSyncError(
        VaultSyncErrorCodes.LEDGER_READ_FAILED,
        "Failed to read vaultCidHash from on-chain ledger",
        true,
        error instanceof Error ? error : void 0
      );
    }
    if (!onChainCidHash) {
      throw new VaultSyncError(
        VaultSyncErrorCodes.VAULT_NOT_FOUND,
        "No vault registration found on-chain",
        false
      );
    }
    const onChainCidHashHex = bytesToHex(onChainCidHash);
    const local = await loadProvider.getLocalCid();
    if (local.cidHash && local.cidHash === onChainCidHashHex) {
      return null;
    }
    let cid;
    try {
      cid = await loadProvider.discoverCidByHash(onChainCidHash);
    } catch (error) {
      throw new VaultSyncError(
        VaultSyncErrorCodes.CID_DISCOVERY_FAILED,
        "Failed to discover CID from Pinata pin listing",
        true,
        error instanceof Error ? error : void 0
      );
    }
    if (!cid) {
      throw new VaultSyncError(
        VaultSyncErrorCodes.CID_DISCOVERY_FAILED,
        "No matching CID found in Pinata pins for on-chain hash",
        false
      );
    }
    let encryptedBytes;
    try {
      encryptedBytes = await loadProvider.downloadFromIpfs(cid);
    } catch (error) {
      throw new VaultSyncError(
        VaultSyncErrorCodes.IPFS_DOWNLOAD_FAILED,
        "Failed to download encrypted vault from IPFS",
        true,
        error instanceof Error ? error : void 0
      );
    }
    try {
      await loadProvider.persistCid(cid, onChainCidHashHex);
    } catch (error) {
      throw new VaultSyncError(
        VaultSyncErrorCodes.CID_PERSISTENCE_FAILED,
        "Failed to persist CID locally after download",
        true,
        error instanceof Error ? error : void 0
      );
    }
    return {
      encryptedBytes,
      cid,
      cidHash: onChainCidHashHex,
      source: "ipfs-download"
    };
  }
  /**
   * Save an encrypted vault blob through the full pipeline.
   *
   * Flow:
   * 1. Upload encrypted bytes to IPFS → CID
   * 2. SHA-256 hash the CID string → cidHash (Bytes<32> for on-chain)
   * 3. Update VaultRegistry contract with cidHash
   * 4. Persist CID + cidHash locally for quick access
   */
  async saveVault(encryptedVaultBytes) {
    if (!this.provider) {
      throw new Error("VaultSyncProvider is required for saveVault(). Pass a provider to the constructor.");
    }
    if (!encryptedVaultBytes || encryptedVaultBytes.length === 0) {
      throw new VaultSyncError(
        VaultSyncErrorCodes.INVALID_ENCRYPTED_DATA,
        "Encrypted vault data must not be empty",
        false
      );
    }
    let cid;
    try {
      cid = await this.provider.uploadToIpfs(encryptedVaultBytes);
    } catch (error) {
      throw new VaultSyncError(
        VaultSyncErrorCodes.IPFS_UPLOAD_FAILED,
        "Failed to upload encrypted vault to IPFS",
        true,
        error instanceof Error ? error : void 0
      );
    }
    const cidHashBytes = await sha256(cid);
    const cidHashHex = bytesToHex(cidHashBytes);
    try {
      await this.provider.updateContractCidHash(cidHashBytes);
    } catch (error) {
      throw new VaultSyncError(
        VaultSyncErrorCodes.CONTRACT_UPDATE_FAILED,
        "Failed to update vault CID hash on-chain",
        false,
        error instanceof Error ? error : void 0
      );
    }
    try {
      await this.provider.persistCid(cid, cidHashHex);
    } catch (error) {
      throw new VaultSyncError(
        VaultSyncErrorCodes.CID_PERSISTENCE_FAILED,
        "Failed to persist CID locally",
        true,
        error instanceof Error ? error : void 0
      );
    }
    return { cid, cidHash: cidHashHex };
  }
  async encryptOrThrow(encrypt, plaintext, key) {
    try {
      return await encrypt(plaintext, key);
    } catch (error) {
      throw new VaultSyncError(
        VaultSyncErrorCodes.ENCRYPT_FAILED,
        "Failed to encrypt vault data",
        false,
        error instanceof Error ? error : void 0
      );
    }
  }
  /**
   * Save vault with conflict detection: check on-chain hash vs local, merge if different.
   *
   * Flow:
   * 1. Read on-chain cidHash via loadProvider
   * 2. Compare with locally cached cidHash
   * 3. Same → save normally (no conflict)
   * 4. Different → download remote, decrypt, merge, re-encrypt, save merged
   *
   * Platform-agnostic: decrypt/encrypt callbacks are provided by the caller
   * (browser extension passes EncryptionUtility wrappers).
   *
   * @param localVaultJson - Decrypted local vault as JSON string
   * @param encryptionKey - Key for decrypting remote vault and re-encrypting merged vault
   * @param loadProvider - Platform-specific provider for reading on-chain hash, downloading from IPFS
   * @param decrypt - Callback to decrypt remote vault bytes → JSON string
   * @param encrypt - Callback to encrypt merged vault JSON string → Uint8Array
   */
  async saveWithConflictCheck(localVaultJson, encryptionKey, loadProvider, decrypt, encrypt) {
    if (!this.provider) {
      throw new Error("VaultSyncProvider is required for saveWithConflictCheck(). Pass a provider to the constructor.");
    }
    let onChainCidHash;
    try {
      onChainCidHash = await loadProvider.readContractCidHash();
    } catch (error) {
      throw new VaultSyncError(
        VaultSyncErrorCodes.LEDGER_READ_FAILED,
        "Failed to read vaultCidHash from on-chain ledger",
        true,
        error instanceof Error ? error : void 0
      );
    }
    const local = await loadProvider.getLocalCid();
    if (!local.cidHash || !onChainCidHash) {
      const encryptedBytes = await this.encryptOrThrow(encrypt, localVaultJson, encryptionKey);
      const result2 = await this.saveVault(encryptedBytes);
      return { ...result2, merged: false, uploadedBytes: encryptedBytes };
    }
    const onChainCidHashHex = bytesToHex(onChainCidHash);
    if (local.cidHash === onChainCidHashHex) {
      const encryptedBytes = await this.encryptOrThrow(encrypt, localVaultJson, encryptionKey);
      const result2 = await this.saveVault(encryptedBytes);
      return { ...result2, merged: false, uploadedBytes: encryptedBytes };
    }
    let remoteCid;
    try {
      remoteCid = await loadProvider.discoverCidByHash(onChainCidHash);
    } catch (error) {
      throw new VaultSyncError(
        VaultSyncErrorCodes.CID_DISCOVERY_FAILED,
        "Failed to discover CID from Pinata pin listing during conflict resolution",
        true,
        error instanceof Error ? error : void 0
      );
    }
    if (!remoteCid) {
      throw new VaultSyncError(
        VaultSyncErrorCodes.CID_DISCOVERY_FAILED,
        "No matching CID found in Pinata pins for on-chain hash during conflict resolution",
        false
      );
    }
    let remoteEncryptedBytes;
    try {
      remoteEncryptedBytes = await loadProvider.downloadFromIpfs(remoteCid);
    } catch (error) {
      throw new VaultSyncError(
        VaultSyncErrorCodes.IPFS_DOWNLOAD_FAILED,
        "Failed to download remote vault from IPFS during conflict resolution",
        true,
        error instanceof Error ? error : void 0
      );
    }
    let remoteVaultJson;
    try {
      remoteVaultJson = await decrypt(remoteEncryptedBytes, encryptionKey);
    } catch (error) {
      throw new VaultSyncError(
        VaultSyncErrorCodes.MERGE_DECRYPT_FAILED,
        "Failed to decrypt remote vault for merge \u2014 encryption key may have changed on another device",
        false,
        error instanceof Error ? error : void 0
      );
    }
    let mergedJson;
    let summary;
    try {
      const localVault = JSON.parse(localVaultJson);
      const remoteVault = JSON.parse(remoteVaultJson);
      const mergeResult = (0, import_vault_types.resolveVaultConflict)(localVault, remoteVault);
      mergedJson = JSON.stringify(mergeResult.merged);
      summary = mergeResult.summary;
    } catch (error) {
      throw new VaultSyncError(
        VaultSyncErrorCodes.MERGE_FAILED,
        "Failed to merge local and remote vaults",
        false,
        error instanceof Error ? error : void 0
      );
    }
    const mergedEncryptedBytes = await this.encryptOrThrow(encrypt, mergedJson, encryptionKey);
    const result = await this.saveVault(mergedEncryptedBytes);
    return {
      ...result,
      merged: true,
      summary,
      uploadedBytes: mergedEncryptedBytes
    };
  }
};

// src/recovery-crypto.ts
var secrets = __toESM(require_secrets());
async function deriveEncryptionKey(shamirSecret) {
  return sha256("aliasvault:rk:" + bytesToHex(shamirSecret));
}
async function generateRecoveryKey() {
  return crypto.getRandomValues(new Uint8Array(32));
}
async function encryptWithRecoveryKey(plaintext, recoveryKey) {
  const key = await crypto.subtle.importKey("raw", recoveryKey, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
  const result = new Uint8Array(12 + ciphertext.byteLength);
  result.set(iv, 0);
  result.set(new Uint8Array(ciphertext), 12);
  return result;
}
async function decryptWithRecoveryKey(encrypted, recoveryKey) {
  const key = await crypto.subtle.importKey("raw", recoveryKey, "AES-GCM", false, ["decrypt"]);
  const iv = encrypted.slice(0, 12);
  const ciphertext = encrypted.slice(12);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return new TextDecoder().decode(decrypted);
}
function splitIntoShares(dataHex, totalShares, threshold) {
  return secrets.share(dataHex, totalShares, threshold);
}
function combineShares(shares) {
  return secrets.combine(shares);
}
async function encryptShareForGuardian(shareHex, guardianPublicKeyJwk) {
  const publicKey = await crypto.subtle.importKey(
    "jwk",
    guardianPublicKeyJwk,
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"]
  );
  const isOdd = shareHex.length % 2 !== 0;
  const paddedHex = isOdd ? "0" + shareHex : shareHex;
  const shareData = hexToUint8Array(paddedHex);
  const payload = new Uint8Array(1 + shareData.length);
  payload[0] = isOdd ? 1 : 0;
  payload.set(shareData, 1);
  const encrypted = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, publicKey, payload);
  return new Uint8Array(encrypted);
}
async function decryptShareFromGuardian(encryptedShare, guardianPrivateKeyJwk) {
  const privateKey = await crypto.subtle.importKey(
    "jwk",
    guardianPrivateKeyJwk,
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["decrypt"]
  );
  const decrypted = await crypto.subtle.decrypt({ name: "RSA-OAEP" }, privateKey, encryptedShare);
  const decryptedArray = new Uint8Array(decrypted);
  const isOdd = decryptedArray[0] === 1;
  const hex = bytesToHex(decryptedArray.slice(1));
  return isOdd ? hex.slice(1) : hex;
}
async function generateGuardianKeyPair() {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSA-OAEP",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256"
    },
    true,
    ["encrypt", "decrypt"]
  );
  const publicKey = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const privateKey = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
  return { publicKey, privateKey };
}

// src/recovery-setup.ts
async function setupGuardianRecovery(params) {
  const { masterPassword, guardianPublicKeys, ownerCommitment } = params;
  if (!masterPassword) {
    throw new Error("masterPassword is required");
  }
  if (!Array.isArray(guardianPublicKeys) || guardianPublicKeys.length !== 3) {
    throw new Error("Exactly 3 guardian public keys are required");
  }
  for (let i = 0; i < guardianPublicKeys.length; i++) {
    if (!guardianPublicKeys[i] || typeof guardianPublicKeys[i] !== "object") {
      throw new Error(`Guardian public key at index ${i} is invalid`);
    }
  }
  if (!ownerCommitment || typeof ownerCommitment !== "string") {
    throw new Error("ownerCommitment is required");
  }
  const shamirSecret = await generateRecoveryKey();
  const encryptionKey = await deriveEncryptionKey(shamirSecret);
  const encryptedPassword = await encryptWithRecoveryKey(masterPassword, encryptionKey);
  const shares = splitIntoShares(bytesToHex(shamirSecret), 3, 2);
  const encryptedShares = [];
  for (let i = 0; i < shares.length; i++) {
    const encrypted = await encryptShareForGuardian(shares[i], guardianPublicKeys[i]);
    encryptedShares.push({
      index: i,
      encryptedShare: uint8ArrayToBase64(encrypted)
    });
  }
  const recoveryKeyHash = await sha256(bytesToHex(shamirSecret));
  const sharePackage = {
    version: 2,
    vaultOwnerCommitment: ownerCommitment,
    threshold: 2,
    totalShares: 3,
    encryptedPassword: uint8ArrayToBase64(encryptedPassword),
    shares: encryptedShares
  };
  shamirSecret.fill(0);
  encryptionKey.fill(0);
  return { recoveryKeyHash, sharePackage };
}

// src/recovery-persist.ts
import { assertCIDv1 } from "@aliasvault/contract";
async function persistGuardianRecovery(setupResult, provider) {
  const json = JSON.stringify(setupResult.sharePackage);
  const bytes = new TextEncoder().encode(json);
  const sharesCid = await provider.uploadToIpfs(bytes);
  assertCIDv1(sharesCid);
  const sharesCidHash = await sha256(sharesCid);
  await provider.storeSharesCidHash(sharesCidHash);
  await provider.storeRecoveryKeyHash(setupResult.recoveryKeyHash);
  return { sharesCid };
}

// src/recovery-claim.ts
var RecoveryClaimError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "RecoveryClaimError";
  }
};
var RecoveryClaimErrorCodes = {
  INSUFFICIENT_SHARES: "RECOVERY_CLAIM_INSUFFICIENT_SHARES",
  HASH_MISMATCH: "RECOVERY_CLAIM_HASH_MISMATCH",
  DECRYPTION_FAILED: "RECOVERY_CLAIM_DECRYPTION_FAILED",
  INVALID_SHARE_PACKAGE: "RECOVERY_CLAIM_INVALID_SHARE_PACKAGE",
  INVALID_SHARE_FILE: "RECOVERY_CLAIM_INVALID_SHARE_FILE"
};
async function claimRecovery(params) {
  const { sharePackage, shareFiles, onChainRecoveryKeyHash } = params;
  if (shareFiles.length < sharePackage.threshold) {
    throw new RecoveryClaimError(
      RecoveryClaimErrorCodes.INSUFFICIENT_SHARES,
      `Need at least ${sharePackage.threshold} shares, got ${shareFiles.length}`
    );
  }
  const shamirSecretHex = combineShares(shareFiles.map((s) => s.shareHex));
  const computedHash = await sha256(shamirSecretHex);
  if (bytesToHex(computedHash) !== bytesToHex(onChainRecoveryKeyHash)) {
    throw new RecoveryClaimError(
      RecoveryClaimErrorCodes.HASH_MISMATCH,
      "Reconstructed secret does not match on-chain recovery key hash"
    );
  }
  const encryptionKey = await deriveEncryptionKey(hexToUint8Array(shamirSecretHex));
  let masterPassword;
  try {
    const encryptedBytes = base64ToUint8Array(sharePackage.encryptedPassword);
    masterPassword = await decryptWithRecoveryKey(encryptedBytes, encryptionKey);
  } catch {
    throw new RecoveryClaimError(
      RecoveryClaimErrorCodes.DECRYPTION_FAILED,
      "Failed to decrypt master password with derived key"
    );
  }
  encryptionKey.fill(0);
  return { masterPassword };
}
function validateSharePackage(data) {
  if (!data || typeof data !== "object") {
    throw new RecoveryClaimError(
      RecoveryClaimErrorCodes.INVALID_SHARE_PACKAGE,
      "Share package must be an object"
    );
  }
  const obj = data;
  if (obj.version !== 2) {
    throw new RecoveryClaimError(
      RecoveryClaimErrorCodes.INVALID_SHARE_PACKAGE,
      `Unsupported share package version: ${String(obj.version)}`
    );
  }
  if (typeof obj.encryptedPassword !== "string" || !obj.encryptedPassword) {
    throw new RecoveryClaimError(
      RecoveryClaimErrorCodes.INVALID_SHARE_PACKAGE,
      "Share package missing encryptedPassword"
    );
  }
  if (typeof obj.threshold !== "number" || obj.threshold < 1) {
    throw new RecoveryClaimError(
      RecoveryClaimErrorCodes.INVALID_SHARE_PACKAGE,
      "Share package missing or invalid threshold"
    );
  }
  if (typeof obj.totalShares !== "number" || obj.totalShares < 1) {
    throw new RecoveryClaimError(
      RecoveryClaimErrorCodes.INVALID_SHARE_PACKAGE,
      "Share package missing or invalid totalShares"
    );
  }
  if (typeof obj.vaultOwnerCommitment !== "string" || !obj.vaultOwnerCommitment) {
    throw new RecoveryClaimError(
      RecoveryClaimErrorCodes.INVALID_SHARE_PACKAGE,
      "Share package missing vaultOwnerCommitment"
    );
  }
  if (!Array.isArray(obj.shares) || obj.shares.length === 0) {
    throw new RecoveryClaimError(
      RecoveryClaimErrorCodes.INVALID_SHARE_PACKAGE,
      "Share package must have non-empty shares array"
    );
  }
  for (let i = 0; i < obj.shares.length; i++) {
    const share2 = obj.shares[i];
    if (typeof share2.index !== "number" || typeof share2.encryptedShare !== "string") {
      throw new RecoveryClaimError(
        RecoveryClaimErrorCodes.INVALID_SHARE_PACKAGE,
        `Invalid share at index ${i}`
      );
    }
  }
  return data;
}
function parseSharePackageFromBytes(bytes) {
  const json = new TextDecoder().decode(bytes);
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new RecoveryClaimError(
      RecoveryClaimErrorCodes.INVALID_SHARE_PACKAGE,
      "Share package is not valid JSON"
    );
  }
  return validateSharePackage(parsed);
}
function validateShareFile(data) {
  if (!data || typeof data !== "object") {
    throw new RecoveryClaimError(
      RecoveryClaimErrorCodes.INVALID_SHARE_FILE,
      "Share file must be an object"
    );
  }
  const obj = data;
  if (obj.version !== 1) {
    throw new RecoveryClaimError(
      RecoveryClaimErrorCodes.INVALID_SHARE_FILE,
      `Unsupported share file version: ${String(obj.version)}`
    );
  }
  if (typeof obj.shareIndex !== "number") {
    throw new RecoveryClaimError(
      RecoveryClaimErrorCodes.INVALID_SHARE_FILE,
      "Share file missing shareIndex"
    );
  }
  if (typeof obj.shareHex !== "string" || !obj.shareHex) {
    throw new RecoveryClaimError(
      RecoveryClaimErrorCodes.INVALID_SHARE_FILE,
      "Share file missing shareHex"
    );
  }
  return { version: 1, shareIndex: obj.shareIndex, shareHex: obj.shareHex };
}
export {
  RecoveryClaimError,
  RecoveryClaimErrorCodes,
  VaultSyncError,
  VaultSyncErrorCodes,
  VaultSyncService,
  base64ToUint8Array,
  bytesToHex,
  claimRecovery,
  combineShares,
  decryptShareFromGuardian,
  decryptWithRecoveryKey,
  deriveEncryptionKey,
  encryptShareForGuardian,
  encryptWithRecoveryKey,
  generateGuardianKeyPair,
  generateRecoveryKey,
  hexToUint8Array,
  parseSharePackageFromBytes,
  persistGuardianRecovery,
  setupGuardianRecovery,
  sha256,
  splitIntoShares,
  uint8ArrayToBase64,
  validateShareFile,
  validateSharePackage
};
/*! Bundled license information:

secrets.js-34r7h/secrets.js:
  (* @preserve author Alexander Stetsyuk *)
  (* @preserve author Glenn Rempe <glenn@rempe.us> *)
  (* @license MIT *)
*/
