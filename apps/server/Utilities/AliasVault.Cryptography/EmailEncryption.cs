//-----------------------------------------------------------------------
// <copyright file="EmailEncryption.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Cryptography;

using AliasServerDb;
using AliasVault.Shared.Models.Enums;

/// <summary>
/// Encrypts incoming email contents for the delivery keys of the recipient manifests.
/// </summary>
public static class EmailEncryption
{
    /// <summary>
    /// Encrypt the email contents with a fresh symmetric key, encrypted once per recipient manifest's delivery key.
    /// </summary>
    /// <param name="email">The plaintext email.</param>
    /// <param name="deliveryKeys">The delivery keys of every manifest that claims the alias.</param>
    /// <returns>The email with every sensitive field encrypted.</returns>
    public static Email EncryptEmail(Email email, IReadOnlyCollection<VaultManifestDeliveryKey> deliveryKeys)
    {
        var symmetricKey = Encryption.GenerateRandomSymmetricKey();

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

        foreach (var attachment in email.Attachments)
        {
            attachment.Bytes = Encryption.SymmetricEncrypt(attachment.Bytes, symmetricKey);
        }

        // The attachment bodies detached from the source.
        foreach (var part in email.Parts)
        {
            part.Bytes = Encryption.SymmetricEncrypt(part.Bytes, symmetricKey);
        }

        // The symmetric key, once per recipient manifest's delivery key.
        foreach (var deliveryKey in deliveryKeys)
        {
            var encryptedSymmetricKey = deliveryKey.Algorithm switch
            {
                VaultKeyAlgorithm.RsaOaepSha256 => Encryption.EncryptSymmetricKeyWithRsa(symmetricKey, deliveryKey.PublicKey),
                _ => throw new NotSupportedException($"Delivery key algorithm {deliveryKey.Algorithm} is not supported."),
            };
            email.DecryptionKeys.Add(new EmailDecryptionKey { VaultManifestDeliveryKeyId = deliveryKey.Id, EncryptedSymmetricKey = encryptedSymmetricKey });
        }

        return email;
    }
}
