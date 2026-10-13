//-----------------------------------------------------------------------
// <copyright file="TestDecryption.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Tests.Shared;

using System.Buffers.Text;
using System.Security.Cryptography;
using System.Text.Json;
using AliasServerDb;
using AliasVault.Cryptography;
using Org.BouncyCastle.Crypto.Parameters;
using Org.BouncyCastle.Security;

/// <summary>
/// Client-side decryption counterparts of the server's encryption, for tests only; the server never holds a private key.
/// </summary>
public static class TestDecryption
{
    /// <summary>
    /// Decrypts a symmetric key encrypted with <see cref="Encryption.EncryptSymmetricKeyWithRsa(byte[], string)"/> (BCL RSA-OAEP-SHA256, no label).
    /// </summary>
    /// <param name="ciphertext">The encrypted symmetric key as base64.</param>
    /// <param name="privateKey">The RSA private key in JWK format.</param>
    /// <returns>The decrypted symmetric key.</returns>
    public static byte[] DecryptSymmetricKeyWithRsa(string ciphertext, string privateKey)
    {
        using var rsa = RSA.Create();

        ImportPrivateKey(rsa, privateKey);
        return rsa.Decrypt(Convert.FromBase64String(ciphertext), RSAEncryptionPadding.OaepSHA256);
    }

    /// <summary>
    /// Decrypts a symmetric key encrypted with <see cref="Encryption.EncryptSymmetricKeyWithRsa(byte[], string, string)"/> under an OAEP label.
    /// </summary>
    /// <param name="ciphertext">The encrypted symmetric key as base64.</param>
    /// <param name="privateKey">The RSA private key in JWK format.</param>
    /// <param name="label">The OAEP label the ciphertext was encrypted under.</param>
    /// <returns>The decrypted symmetric key.</returns>
    public static byte[] DecryptSymmetricKeyWithRsa(string ciphertext, string privateKey, string label)
    {
        var jwk = JsonSerializer.Deserialize<JsonElement>(privateKey);
        var key = new RsaPrivateCrtKeyParameters(Encryption.JwkInteger(jwk, "n"), Encryption.JwkInteger(jwk, "e"), Encryption.JwkInteger(jwk, "d"), Encryption.JwkInteger(jwk, "p"), Encryption.JwkInteger(jwk, "q"), Encryption.JwkInteger(jwk, "dp"), Encryption.JwkInteger(jwk, "dq"), Encryption.JwkInteger(jwk, "qi"));
        var oaep = Encryption.LabelledOaep(label);
        oaep.Init(false, new ParametersWithRandom(key, new SecureRandom()));
        var cipherBytes = Convert.FromBase64String(ciphertext);
        return oaep.ProcessBlock(cipherBytes, 0, cipherBytes.Length);
    }

    /// <summary>
    /// Decrypts an email encrypted by <see cref="EmailEncryption.EncryptEmail"/> with the private key of one of its delivery keys.
    /// </summary>
    /// <param name="email">The encrypted email; its fields are replaced with the decrypted values.</param>
    /// <param name="userPrivateKey">The RSA private key in JWK format.</param>
    /// <returns>The same email object with all encrypted fields decrypted.</returns>
    public static Email DecryptEmail(Email email, string userPrivateKey)
    {
        // With multiple decryption keys the matching one is found by trying each.
        byte[]? symmetricKey = null;
        foreach (var decryptionKey in email.DecryptionKeys)
        {
            try
            {
                symmetricKey = DecryptSymmetricKeyWithRsa(decryptionKey.EncryptedSymmetricKey, userPrivateKey);
                break;
            }
            catch (CryptographicException)
            {
                // The key belongs to another manifest; try the next one.
            }
        }

        if (symmetricKey is null)
        {
            throw new InvalidOperationException("The email carries no decryption key that the provided private key can open.");
        }

        if (email.MessageHtml is not null)
        {
            email.MessageHtml = Encryption.SymmetricDecrypt(email.MessageHtml, symmetricKey);
        }

        if (email.MessagePlain is not null)
        {
            email.MessagePlain = Encryption.SymmetricDecrypt(email.MessagePlain, symmetricKey);
        }

        if (email.MessagePreview is not null)
        {
            email.MessagePreview = Encryption.SymmetricDecrypt(email.MessagePreview, symmetricKey);
        }

        if (email.MessageSource is not null)
        {
            email.MessageSource = Encryption.SymmetricDecrypt(email.MessageSource, symmetricKey);
        }

        if (email.MessageSourceBytes is not null)
        {
            // The decrypted bytes are the gzip-compressed source; callers must gunzip to get the raw MIME.
            email.MessageSourceBytes = Encryption.SymmetricDecrypt(email.MessageSourceBytes, symmetricKey);
        }

        email.Subject = Encryption.SymmetricDecrypt(email.Subject, symmetricKey);
        email.From = Encryption.SymmetricDecrypt(email.From, symmetricKey);
        email.FromLocal = Encryption.SymmetricDecrypt(email.FromLocal, symmetricKey);
        email.FromDomain = Encryption.SymmetricDecrypt(email.FromDomain, symmetricKey);

        // Decrypt the attachment bodies that were detached from the source.
        foreach (var part in email.Parts)
        {
            part.Bytes = Encryption.SymmetricDecrypt(part.Bytes, symmetricKey);
        }

        return email;
    }

    /// <summary>
    /// Imports an RSA private key from JWK format.
    /// </summary>
    /// <param name="rsa">The RSA provider to import the key into.</param>
    /// <param name="jwk">The private key in JWK format.</param>
    private static void ImportPrivateKey(RSA rsa, string jwk)
    {
        var jwkObj = JsonSerializer.Deserialize<JsonElement>(jwk);
        byte[] Member(string name) => Base64Url.DecodeFromChars(jwkObj.GetProperty(name).GetString()!);

        rsa.ImportParameters(new RSAParameters
        {
            Modulus = Member("n"),
            Exponent = Member("e"),
            D = Member("d"),
            P = Member("p"),
            Q = Member("q"),
            DP = Member("dp"),
            DQ = Member("dq"),
            InverseQ = Member("qi"),
        });
    }
}
