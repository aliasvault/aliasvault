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
    /// Generates a random AES-256 key.
    /// </summary>
    /// <returns>The 32-byte key.</returns>
    public static byte[] GenerateRandomSymmetricKey()
    {
        return RandomNumberGenerator.GetBytes(32);
    }

    /// <summary>
    /// Encrypts a symmetric key for the holder of an RSA public key with RSA-OAEP-SHA256 and no label (every email key).
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
    /// decryption must present as-is.
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
    /// Encrypts a UTF-8 string with AES-256-GCM.
    /// </summary>
    /// <param name="plaintext">The plaintext string.</param>
    /// <param name="key">The 32-byte key.</param>
    /// <returns>Base64 of nonce | ciphertext | tag.</returns>
    public static string SymmetricEncrypt(string plaintext, byte[] key)
    {
        return Convert.ToBase64String(SymmetricEncrypt(Encoding.UTF8.GetBytes(plaintext), key));
    }

    /// <summary>
    /// Encrypts bytes with AES-256-GCM (random 12-byte nonce, 16-byte tag, no AAD).
    /// </summary>
    /// <param name="plainBytes">The plaintext bytes.</param>
    /// <param name="key">The 32-byte key.</param>
    /// <returns>nonce | ciphertext | tag.</returns>
    public static byte[] SymmetricEncrypt(byte[] plainBytes, byte[] key)
    {
        byte[] nonce = new byte[AesGcm.NonceByteSizes.MaxSize];
        RandomNumberGenerator.Fill(nonce);

        byte[] ciphertext = new byte[plainBytes.Length];
        byte[] tag = new byte[AesGcm.TagByteSizes.MaxSize];

        using var aesGcm = new AesGcm(key, AesGcm.TagByteSizes.MaxSize);
        aesGcm.Encrypt(nonce, plainBytes, ciphertext, tag);

        byte[] result = new byte[nonce.Length + ciphertext.Length + tag.Length];
        Buffer.BlockCopy(nonce, 0, result, 0, nonce.Length);
        Buffer.BlockCopy(ciphertext, 0, result, nonce.Length, ciphertext.Length);
        Buffer.BlockCopy(tag, 0, result, nonce.Length + ciphertext.Length, tag.Length);

        return result;
    }

    /// <summary>
    /// Decrypts base64 nonce | ciphertext | tag with AES-256-GCM into a UTF-8 string.
    /// </summary>
    /// <param name="ciphertext">The base64 ciphertext.</param>
    /// <param name="key">The 32-byte key.</param>
    /// <returns>The plaintext string.</returns>
    public static string SymmetricDecrypt(string ciphertext, byte[] key)
    {
        var plainBytes = SymmetricDecrypt(Convert.FromBase64String(ciphertext), key);
        return Encoding.UTF8.GetString(plainBytes).TrimEnd('\0');
    }

    /// <summary>
    /// Decrypts nonce | ciphertext | tag bytes with AES-256-GCM.
    /// </summary>
    /// <param name="encryptedBytes">The encrypted bytes.</param>
    /// <param name="key">The 32-byte key.</param>
    /// <returns>The plaintext bytes.</returns>
    public static byte[] SymmetricDecrypt(byte[] encryptedBytes, byte[] key)
    {
        int nonceSize = AesGcm.NonceByteSizes.MaxSize;
        int tagSize = AesGcm.TagByteSizes.MaxSize;
        if (encryptedBytes.Length < nonceSize + tagSize)
        {
            throw new CryptographicException("AES-GCM ciphertext is too short.");
        }

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
