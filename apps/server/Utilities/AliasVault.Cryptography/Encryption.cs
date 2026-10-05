//-----------------------------------------------------------------------
// <copyright file="Encryption.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Cryptography;

using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

/// <summary>
/// RSA/AES and Argon2id encryption methods.
/// </summary>
public static class Encryption
{
    /// <summary>
    /// Generates a random symmetric key for use with AES-256.
    /// </summary>
    /// <returns>A 256-bit (32-byte) random key as a byte array.</returns>
    public static byte[] GenerateRandomSymmetricKey()
    {
        return RandomNumberGenerator.GetBytes(32); // 256 bits
    }

    /// <summary>
    /// Encrypts a symmetric key using an RSA public key.
    /// </summary>
    /// <param name="symmetricKey">The symmetric key to encrypt.</param>
    /// <param name="publicKey">The RSA public key in JWK format.</param>
    /// <returns>The encrypted symmetric key as a base64-encoded string.</returns>
    public static string EncryptSymmetricKeyWithRsa(byte[] symmetricKey, string publicKey)
    {
        using (var rsa = RSA.Create())
        {
            ImportPublicKey(rsa, publicKey);
            var rsaParams = RSAEncryptionPadding.OaepSHA256;

            byte[] encryptedKey = rsa.Encrypt(symmetricKey, rsaParams);
            return Convert.ToBase64String(encryptedKey);
        }
    }

    /// <summary>
    /// Decrypts an encrypted symmetric key using an RSA private key.
    /// </summary>
    /// <param name="ciphertext">The encrypted symmetric key as ciphertext.</param>
    /// <param name="privateKey">The RSA private key in JWK format.</param>
    /// <returns>The encrypted symmetric key as a base64-encoded string.</returns>
    public static byte[] DecryptSymmetricKeyWithRsa(string ciphertext, string privateKey)
    {
        using var rsa = RSA.Create();

        ImportPrivateKey(rsa, privateKey);
        var rsaParams = RSAEncryptionPadding.OaepSHA256;

        byte[] cipherBytes = Convert.FromBase64String(ciphertext);
        return rsa.Decrypt(cipherBytes, rsaParams);
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
    /// Imports a public key from JWK format into an RSA provider.
    /// </summary>
    /// <param name="rsa">The RSA provider to import the key into.</param>
    /// <param name="jwk">The public key in JWK format.</param>
    private static void ImportPublicKey(RSA rsa, string jwk)
    {
        var jwkObj = JsonSerializer.Deserialize<JsonElement>(jwk);
        var n = Base64UrlDecode(jwkObj.GetProperty("n").GetString()!);
        var e = Base64UrlDecode(jwkObj.GetProperty("e").GetString()!);

        var rsaParameters = new RSAParameters
        {
            Modulus = n,
            Exponent = e,
        };

        rsa.ImportParameters(rsaParameters);
    }

    /// <summary>
    /// Imports a private key from JWK format into an RSA provider.
    /// </summary>
    /// <param name="rsa">The RSA provider to import the key into.</param>
    /// <param name="jwk">The private key in JWK format.</param>
    private static void ImportPrivateKey(RSA rsa, string jwk)
    {
        var jwkObj = JsonSerializer.Deserialize<JsonElement>(jwk);
        var n = Base64UrlDecode(jwkObj.GetProperty("n").GetString()!);
        var e = Base64UrlDecode(jwkObj.GetProperty("e").GetString()!);
        var d = Base64UrlDecode(jwkObj.GetProperty("d").GetString()!);
        var p = Base64UrlDecode(jwkObj.GetProperty("p").GetString()!);
        var q = Base64UrlDecode(jwkObj.GetProperty("q").GetString()!);
        var dp = Base64UrlDecode(jwkObj.GetProperty("dp").GetString()!);
        var dq = Base64UrlDecode(jwkObj.GetProperty("dq").GetString()!);
        var qi = Base64UrlDecode(jwkObj.GetProperty("qi").GetString()!);

        var rsaParameters = new RSAParameters
        {
            Modulus = n,
            Exponent = e,
            D = d,
            P = p,
            Q = q,
            DP = dp,
            DQ = dq,
            InverseQ = qi,
        };

        rsa.ImportParameters(rsaParameters);
    }

    /// <summary>
    /// Decodes a Base64Url-encoded string to a byte array.
    /// </summary>
    /// <param name="base64Url">The Base64Url-encoded string.</param>
    /// <returns>The decoded byte array.</returns>
    private static byte[] Base64UrlDecode(string base64Url)
    {
        string padded = base64Url;
        switch (base64Url.Length % 4)
        {
            case 2: padded += "=="; break;
            case 3: padded += "="; break;
        }

        string base64 = padded.Replace("-", "+").Replace("_", "/");
        return Convert.FromBase64String(base64);
    }
}
