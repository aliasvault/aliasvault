//-----------------------------------------------------------------------
// <copyright file="AvexCryptoService.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Services.Crypto;

using System.Text;
using System.Text.Json;
using AliasVault.Client.Services.JsInterop;
using AliasVault.Client.Services.JsInterop.RustCore;
using AliasVault.ImportExport.Constants;
using AliasVault.ImportExport.Models.Exports;
using AliasVault.Shared.Core;

/// <summary>
/// Provides cryptographic operations for .avex encrypted vault export format.
/// Handles encryption/decryption of .avex files using Argon2id KDF and AES-256-GCM.
/// </summary>
public class AvexCryptoService
{
    private readonly JsInteropService jsInteropService;
    private readonly RustCoreService rustCoreService;

    /// <summary>
    /// Initializes a new instance of the <see cref="AvexCryptoService"/> class.
    /// </summary>
    /// <param name="jsInteropService">The JS interop service.</param>
    /// <param name="rustCoreService">The Rust core service.</param>
    public AvexCryptoService(JsInteropService jsInteropService, RustCoreService rustCoreService)
    {
        this.jsInteropService = jsInteropService;
        this.rustCoreService = rustCoreService;
    }

    /// <summary>
    /// Encrypts vault data to .avex format using Web Crypto API.
    /// Uses Argon2id for key derivation and AES-256-GCM for encryption.
    /// </summary>
    /// <param name="avuxBytes">The unencrypted .avux bytes.</param>
    /// <param name="exportPassword">The password to encrypt with.</param>
    /// <param name="username">The username creating the export.</param>
    /// <returns>The encrypted .avex file bytes.</returns>
    public async Task<byte[]> EncryptToAvexAsync(byte[] avuxBytes, string exportPassword, string username)
    {
        // 1. Generate random salt
        var salt = await this.jsInteropService.GenerateSalt(32);

        // 2. Derive key using Argon2id (same as existing vault encryption)
        var saltBase64 = Convert.ToBase64String(salt);
        var key = await this.rustCoreService.Argon2DeriveKeyAsync(exportPassword, saltBase64, AliasVault.Cryptography.Client.Defaults.EncryptionSettings);

        // 3. Encrypt the .avux bytes using AES-256-GCM via JavaScript
        var encryptedPayload = await this.jsInteropService.SymmetricEncryptBytes(avuxBytes, key);

        // 4. Create header
        var header = new AvexHeader
        {
            Format = AvexConstants.FormatIdentifier,
            Version = AvexConstants.FormatVersion,
            Kdf = new KdfParams
            {
                Type = AliasVault.Cryptography.Client.Defaults.EncryptionType, // Argon2Id
                Salt = saltBase64,
                Params = new Dictionary<string, int>
                {
                    ["DegreeOfParallelism"] = AliasVault.Cryptography.Client.Defaults.Argon2IdDegreeOfParallelism,
                    ["MemorySize"] = AliasVault.Cryptography.Client.Defaults.Argon2IdMemorySize,
                    ["Iterations"] = AliasVault.Cryptography.Client.Defaults.Argon2IdIterations,
                },
            },
            Encryption = new EncryptionParams
            {
                Algorithm = "AES-256-GCM",
                EncryptedDataOffset = 0,
            },
            Metadata = new AvexMetadata
            {
                ExportedAt = DateTime.UtcNow,
                ExportedBy = username,
                AppVersion = AppInfo.GetFullVersion(),
            },
        };

        // 5. Serialize header
        var jsonOptions = new JsonSerializerOptions
        {
            WriteIndented = true,
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        };

        var headerJson = JsonSerializer.Serialize(header, jsonOptions);
        var headerBytes = Encoding.UTF8.GetBytes(headerJson);
        var delimiterBytes = Encoding.UTF8.GetBytes(AvexConstants.HeaderDelimiter);

        // 6. Calculate offset
        header.Encryption.EncryptedDataOffset = headerBytes.Length + delimiterBytes.Length;

        // Re-serialize with correct offset
        headerJson = JsonSerializer.Serialize(header, jsonOptions);
        headerBytes = Encoding.UTF8.GetBytes(headerJson);

        // 7. Combine header + delimiter + encrypted payload
        var avexFile = new byte[headerBytes.Length + delimiterBytes.Length + encryptedPayload.Length];
        Buffer.BlockCopy(headerBytes, 0, avexFile, 0, headerBytes.Length);
        Buffer.BlockCopy(delimiterBytes, 0, avexFile, headerBytes.Length, delimiterBytes.Length);
        Buffer.BlockCopy(encryptedPayload, 0, avexFile, headerBytes.Length + delimiterBytes.Length, encryptedPayload.Length);

        return avexFile;
    }

    /// <summary>
    /// Decrypts .avex file to .avux bytes using Web Crypto API.
    /// </summary>
    /// <param name="avexBytes">The encrypted .avex file bytes.</param>
    /// <param name="exportPassword">The password to decrypt with.</param>
    /// <returns>The decrypted .avux file bytes.</returns>
    public async Task<byte[]> DecryptAvexAsync(byte[] avexBytes, string exportPassword)
    {
        // 1. Parse header
        var (header, payloadOffset) = ParseAvexHeader(avexBytes);

        // 2. Validate version
        if (header.Version != AvexConstants.FormatVersion)
        {
            throw new InvalidOperationException($"Unsupported .avex version: {header.Version}. Expected {AvexConstants.FormatVersion}.");
        }

        // 3. Extract encrypted payload
        var encryptedPayloadLength = avexBytes.Length - (int)payloadOffset;
        var encryptedPayload = new byte[encryptedPayloadLength];
        Buffer.BlockCopy(avexBytes, (int)payloadOffset, encryptedPayload, 0, encryptedPayloadLength);

        /*
         * 4. Derive key using Argon2id via the Rust core.
         */
        if (header.Kdf.Type.ToLowerInvariant() != "argon2id")
        {
            throw new InvalidOperationException($"Unsupported KDF type: {header.Kdf.Type}. Only Argon2id is supported.");
        }

        var kdfSettings = JsonSerializer.Serialize(header.Kdf.Params);
        var key = await this.rustCoreService.Argon2DeriveKeyAsync(exportPassword, header.Kdf.Salt, kdfSettings);

        // 5. Decrypt payload
        byte[] avuxBytes;
        try
        {
            avuxBytes = await this.jsInteropService.SymmetricDecryptBytesRaw(encryptedPayload, key);
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException("Failed to decrypt .avex file. The password may be incorrect or the file may be corrupted.", ex);
        }

        return avuxBytes;
    }

    /// <summary>
    /// Parses the .avex header.
    /// </summary>
    private static (AvexHeader Header, long PayloadOffset) ParseAvexHeader(byte[] avexBytes)
    {
        var delimiterBytes = Encoding.UTF8.GetBytes(AvexConstants.HeaderDelimiter);
        var delimiterIndex = IndexOf(avexBytes, delimiterBytes);

        if (delimiterIndex == -1)
        {
            throw new InvalidOperationException("Invalid .avex file: header delimiter not found");
        }

        var headerBytes = new byte[delimiterIndex];
        Buffer.BlockCopy(avexBytes, 0, headerBytes, 0, delimiterIndex);
        var headerJson = Encoding.UTF8.GetString(headerBytes);

        var jsonOptions = new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true,
        };

        var header = JsonSerializer.Deserialize<AvexHeader>(headerJson, jsonOptions);

        if (header == null || header.Format != AvexConstants.FormatIdentifier)
        {
            throw new InvalidOperationException($"Invalid .avex file: expected format '{AvexConstants.FormatIdentifier}', got '{header?.Format ?? "null"}'");
        }

        var payloadOffset = delimiterIndex + delimiterBytes.Length;
        return (header, payloadOffset);
    }

    /// <summary>
    /// Finds the index of a byte pattern within a byte array.
    /// </summary>
    private static int IndexOf(byte[] source, byte[] pattern)
    {
        if (pattern.Length > source.Length)
        {
            return -1;
        }

        for (int i = 0; i <= source.Length - pattern.Length; i++)
        {
            bool found = true;
            for (int j = 0; j < pattern.Length; j++)
            {
                if (source[i + j] != pattern[j])
                {
                    found = false;
                    break;
                }
            }

            if (found)
            {
                return i;
            }
        }

        return -1;
    }
}
