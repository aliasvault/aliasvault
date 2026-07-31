//-----------------------------------------------------------------------
// <copyright file="EmailEncryption.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Cryptography.Server;

using AliasServerDb;

/// <summary>
/// Helper class for encrypting and decrypting email contents.
/// </summary>
public static class EmailEncryption
{
    /// <summary>
    /// Encrypt the email contents with the user's public key.
    /// </summary>
    /// <param name="email">The plain text email object to encrypt.</param>
    /// <param name="encryptionKey">The user public encryption key to use for the encryption.</param>
    /// <returns>Email object with all sensitive fields encrypted.</returns>
    public static Email EncryptEmail(Email email, EncryptionKey encryptionKey)
    {
        // Generate symmetric key for email encryption.
        var symmetricKey = Encryption.GenerateRandomSymmetricKey();

        // Encrypt all email contents with the symmetric key.
        if (email.MessageHtml is not null)
        {
            email.MessageHtml = Encryption.SymmetricEncrypt(email.MessageHtml, symmetricKey);
        }

        if (email.MessagePlain is not null)
        {
            email.MessagePlain = Encryption.SymmetricEncrypt(email.MessagePlain, symmetricKey);
        }

        if (email.MessagePreview is not null)
        {
            email.MessagePreview = Encryption.SymmetricEncrypt(email.MessagePreview, symmetricKey);
        }

        email.MessageSource = Encryption.SymmetricEncrypt(email.MessageSource, symmetricKey);
        email.Subject = Encryption.SymmetricEncrypt(email.Subject, symmetricKey);
        email.From = Encryption.SymmetricEncrypt(email.From, symmetricKey);
        email.FromLocal = Encryption.SymmetricEncrypt(email.FromLocal, symmetricKey);
        email.FromDomain = Encryption.SymmetricEncrypt(email.FromDomain, symmetricKey);

        // Encrypt all attachments with the symmetric key.
        foreach (var attachment in email.Attachments)
        {
            attachment.Bytes = Encryption.SymmetricEncrypt(attachment.Bytes, symmetricKey);
        }

        // Encrypt the symmetric key with the user's public key.
        email.EncryptedSymmetricKey = Encryption.EncryptSymmetricKeyWithRsa(symmetricKey, encryptionKey.PublicKey);
        email.EncryptionKeyId = encryptionKey.Id;

        return email;
    }

    /// <summary>
    /// Decrypt the email contents with the user's private key.
    /// </summary>
    /// <param name="email">The plain text email object to decrypt.</param>
    /// <param name="userPrivateKey">The user private encryption key to use for the decryption.</param>
    /// <returns>Email object with all sensitive fields decrypted.</returns>
    public static Email DecryptEmail(Email email, string userPrivateKey)
    {
        // Decrypt symmetric key using private key.
        var symmetricKey = Encryption.DecryptSymmetricKeyWithRsa(email.EncryptedSymmetricKey, userPrivateKey);

        // Encrypt all email contents with the symmetric key.
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

        email.MessageSource = Encryption.SymmetricDecrypt(email.MessageSource, symmetricKey);
        email.Subject = Encryption.SymmetricDecrypt(email.Subject, symmetricKey);
        email.From = Encryption.SymmetricDecrypt(email.From, symmetricKey);
        email.FromLocal = Encryption.SymmetricDecrypt(email.FromLocal, symmetricKey);
        email.FromDomain = Encryption.SymmetricDecrypt(email.FromDomain, symmetricKey);

        return email;
    }
}
