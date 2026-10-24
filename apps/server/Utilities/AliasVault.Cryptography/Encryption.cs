//-----------------------------------------------------------------------
// <copyright file="Encryption.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Cryptography;

using System.Buffers.Text;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Org.BouncyCastle.Crypto.Digests;
using Org.BouncyCastle.Crypto.Encodings;
using Org.BouncyCastle.Crypto.Engines;
using Org.BouncyCastle.Crypto.Parameters;
using Org.BouncyCastle.Security;

/// <summary>
/// The server's encryption: AES-256-GCM (.NET) over email contents and RSA-OAEP-SHA256 (BouncyCastle, for the label
/// support) of the symmetric keys for client public keys. The server never holds a private key.
/// </summary>
public static class Encryption
{
    /// <summary>
    /// The RSA-OAEP label of the session payload key the server encrypts for a mobile login request's one-off public key.
    /// Must match <c>MOBILE_LOGIN_PAYLOAD_KEY</c> in <c>core/rust/src/crypto/aad.rs</c>.
    /// </summary>
    public const string MobileLoginPayloadKeyLabel = "aliasvault/v1/mobile-login/payload-key";

    /// <summary>
    /// Generates a random symmetric key for use with AES-256.
    /// </summary>
    /// <returns>A 256-bit (32-byte) random key as a byte array.</returns>
    public static byte[] GenerateRandomSymmetricKey()
    {
        return RandomNumberGenerator.GetBytes(32); // 256 bits
    }

    /// <summary>
    /// Encrypts a symmetric key for the holder of an RSA public key with RSA-OAEP-SHA256 and no label: the format every
    /// email key is stored in.
    /// </summary>
    /// <param name="symmetricKey">The symmetric key to encrypt.</param>
    /// <param name="publicKey">The RSA public key in JWK format.</param>
    /// <returns>The encrypted symmetric key as a base64-encoded string.</returns>
    public static string EncryptSymmetricKeyWithRsa(byte[] symmetricKey, string publicKey)
    {
        return EncryptSymmetricKeyWithRsa(symmetricKey, publicKey, string.Empty);
    }

    /// <summary>
    /// Encrypts a symmetric key for the holder of an RSA public key with RSA-OAEP-SHA256 under an OAEP label, which
    /// decryption must present as-is. An empty label is plain RSA-OAEP-SHA256.
    /// </summary>
    /// <param name="symmetricKey">The symmetric key to encrypt.</param>
    /// <param name="publicKey">The RSA public key in JWK format.</param>
    /// <param name="label">The OAEP label.</param>
    /// <returns>The encrypted symmetric key as a base64-encoded string.</returns>
    public static string EncryptSymmetricKeyWithRsa(byte[] symmetricKey, string publicKey, string label)
    {
        var jwk = JsonSerializer.Deserialize<JsonElement>(publicKey);
        var key = new RsaKeyParameters(false, JwkInteger(jwk, "n"), JwkInteger(jwk, "e"));
        var oaep = LabelledOaep(label);
        oaep.Init(true, new ParametersWithRandom(key, new SecureRandom()));
        return Convert.ToBase64String(oaep.ProcessBlock(symmetricKey, 0, symmetricKey.Length));
    }

    /// <summary>
    /// SymmetricEncrypt a plaintext string using AES-256 GCM.
    /// </summary>
    /// <param name="plaintext">The plaintext string.</param>
    /// <param name="key">Key to use for encryption (must be 32 bytes for AES-256).</param>
    /// <returns>The encrypted string (ciphertext).</returns>
    public static string SymmetricEncrypt(string plaintext, byte[] key)
    {
        var encryptedBytes = SymmetricEncrypt(Encoding.UTF8.GetBytes(plaintext), key);
        return Convert.ToBase64String(encryptedBytes);
    }

    /// <summary>
    /// SymmetricEncrypt a byte array using AES-256 GCM.
    /// </summary>
    /// <param name="plainBytes">The plain byte array.</param>
    /// <param name="key">Key to use for encryption (must be 32 bytes for AES-256).</param>
    /// <returns>The encrypted string (ciphertext).</returns>
    public static byte[] SymmetricEncrypt(byte[] plainBytes, byte[] key)
    {
        byte[] nonce = new byte[AesGcm.NonceByteSizes.MaxSize]; // 12 bytes
        RandomNumberGenerator.Fill(nonce);

        byte[] ciphertext = new byte[plainBytes.Length];
        byte[] tag = new byte[AesGcm.TagByteSizes.MaxSize]; // 16 bytes

        using var aesGcm = new AesGcm(key, AesGcm.TagByteSizes.MaxSize);
        aesGcm.Encrypt(nonce, plainBytes, ciphertext, tag);

        // Combine nonce + ciphertext + tag
        byte[] result = new byte[nonce.Length + ciphertext.Length + tag.Length];
        Buffer.BlockCopy(nonce, 0, result, 0, nonce.Length);
        Buffer.BlockCopy(ciphertext, 0, result, nonce.Length, ciphertext.Length);
        Buffer.BlockCopy(tag, 0, result, nonce.Length + ciphertext.Length, tag.Length);

        return result;
    }

    /// <summary>
    /// SymmetricDecrypt a ciphertext string using AES-256 GCM.
    /// </summary>
    /// <param name="ciphertext">The encrypted string (ciphertext).</param>
    /// <param name="key">The key used to originally encrypt the string.</param>
    /// <returns>The original plaintext string.</returns>
    public static string SymmetricDecrypt(string ciphertext, byte[] key)
    {
        var plainBytes = SymmetricDecrypt(Convert.FromBase64String(ciphertext), key);
        return Encoding.UTF8.GetString(plainBytes).TrimEnd('\0');
    }

    /// <summary>
    /// SymmetricDecrypt a cipher byte array using AES-256 GCM.
    /// </summary>
    /// <param name="encryptedBytes">The encrypted byte array (cipherBytes).</param>
    /// <param name="key">The key used to originally encrypt the string.</param>
    /// <returns>The original plaintext string.</returns>
    public static byte[] SymmetricDecrypt(byte[] encryptedBytes, byte[] key)
    {
        int nonceSize = AesGcm.NonceByteSizes.MaxSize;
        int tagSize = AesGcm.TagByteSizes.MaxSize;
        if (encryptedBytes.Length < nonceSize + tagSize)
        {
            throw new CryptographicException("AES-GCM ciphertext is too short.");
        }

        // Extract nonce, ciphertext, and tag
        byte[] nonce = new byte[nonceSize];
        byte[] tag = new byte[tagSize];
        byte[] ciphertext = new byte[encryptedBytes.Length - nonceSize - tagSize];

        Buffer.BlockCopy(encryptedBytes, 0, nonce, 0, nonceSize);
        Buffer.BlockCopy(encryptedBytes, nonceSize, ciphertext, 0, ciphertext.Length);
        Buffer.BlockCopy(encryptedBytes, nonceSize + ciphertext.Length, tag, 0, tagSize);

        byte[] plaintext = new byte[ciphertext.Length];
        using var aesGcm = new AesGcm(key, tagSize);
        aesGcm.Decrypt(nonce, ciphertext, tag, plaintext);

        return plaintext;
    }

    /// <summary>
    /// RSA-OAEP with SHA-256 for both the hash and MGF1, as WebCrypto's RSA-OAEP-256, under the given label.
    /// </summary>
    /// <param name="label">The OAEP label.</param>
    /// <returns>The OAEP encoding, not yet initialized.</returns>
    internal static OaepEncoding LabelledOaep(string label)
    {
        return new OaepEncoding(new RsaBlindedEngine(), new Sha256Digest(), new Sha256Digest(), Encoding.UTF8.GetBytes(label));
    }

    /// <summary>
    /// Reads an unsigned big-endian JWK integer member.
    /// </summary>
    /// <param name="jwk">The parsed JWK.</param>
    /// <param name="name">The member name.</param>
    /// <returns>The integer.</returns>
    internal static Org.BouncyCastle.Math.BigInteger JwkInteger(JsonElement jwk, string name)
    {
        return new Org.BouncyCastle.Math.BigInteger(1, JwkBytes(jwk.GetProperty(name).GetString()!));
    }

    /// <summary>
    /// Decodes a JWK field: base64url, also accepting the standard alphabet and padding that some older stored keys carry.
    /// </summary>
    /// <param name="value">The JWK field value.</param>
    /// <returns>The decoded bytes.</returns>
    private static byte[] JwkBytes(string value)
    {
        return Base64Url.DecodeFromChars(value.Replace('+', '-').Replace('/', '_').TrimEnd('='));
    }
}
