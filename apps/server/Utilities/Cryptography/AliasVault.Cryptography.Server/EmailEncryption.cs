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
    /// Encrypt the email contents with a fresh symmetric key, wrapped once per recipient manifest's delivery key.
    /// </summary>
    /// <param name="email">The plain text email object to encrypt.</param>
    /// <param name="deliveryKeys">The delivery keys of every manifest that claims the alias; each gets its own wrap of the same symmetric key.</param>
    /// <returns>Email object with all sensitive fields encrypted.</returns>
    public static Email EncryptEmail(Email email, IReadOnlyCollection<VaultManifestDeliveryKey> deliveryKeys)
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

        if (email.MessageSource is not null)
        {
            email.MessageSource = Encryption.SymmetricEncrypt(email.MessageSource, symmetricKey);
        }

        if (email.MessageSourceBytes is not null)
        {
            email.MessageSourceBytes = Encryption.SymmetricEncrypt(email.MessageSourceBytes, symmetricKey);
        }

        email.Subject = Encryption.SymmetricEncrypt(email.Subject, symmetricKey);
        email.From = Encryption.SymmetricEncrypt(email.From, symmetricKey);
        email.FromLocal = Encryption.SymmetricEncrypt(email.FromLocal, symmetricKey);
        email.FromDomain = Encryption.SymmetricEncrypt(email.FromDomain, symmetricKey);

        // Encrypt all attachments with the symmetric key.
        foreach (var attachment in email.Attachments)
        {
            attachment.Bytes = Encryption.SymmetricEncrypt(attachment.Bytes, symmetricKey);
        }

        // Wrap the same symmetric key once per recipient manifest's delivery key.
        foreach (var deliveryKey in deliveryKeys)
        {
            email.Wraps.Add(new EmailKeyWrap { EncryptionKeyId = deliveryKey.Id, EncryptedSymmetricKey = Encryption.EncryptSymmetricKeyWithRsa(symmetricKey, deliveryKey.PublicKey) });
        }

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
        // Decrypt the symmetric key from the wrap belonging to this private key; with multiple wraps the
        // matching one is found by simply trying each.
        byte[]? symmetricKey = null;
        foreach (var wrap in email.Wraps)
        {
            try
            {
                symmetricKey = Encryption.DecryptSymmetricKeyWithRsa(wrap.EncryptedSymmetricKey, userPrivateKey);
                break;
            }
            catch (System.Security.Cryptography.CryptographicException)
            {
                // Wrap belongs to another manifest's key; try the next one.
            }
        }

        if (symmetricKey is null)
        {
            throw new InvalidOperationException("The email carries no wrap that the provided private key can open.");
        }

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

        if (email.MessageSource is not null)
        {
            email.MessageSource = Encryption.SymmetricDecrypt(email.MessageSource, symmetricKey);
        }

        if (email.MessageSourceBytes is not null)
        {
            // Note: the decrypted bytes are the gzip-compressed source; callers must gunzip to get the raw MIME.
            email.MessageSourceBytes = Encryption.SymmetricDecrypt(email.MessageSourceBytes, symmetricKey);
        }

        email.Subject = Encryption.SymmetricDecrypt(email.Subject, symmetricKey);
        email.From = Encryption.SymmetricDecrypt(email.From, symmetricKey);
        email.FromLocal = Encryption.SymmetricDecrypt(email.FromLocal, symmetricKey);
        email.FromDomain = Encryption.SymmetricDecrypt(email.FromDomain, symmetricKey);

        return email;
    }
}
