//-----------------------------------------------------------------------
// <copyright file="EmailService.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Services;

using AliasClientDb;
using AliasVault.Shared.Models.Spamok;
using Microsoft.EntityFrameworkCore;

/// <summary>
/// Email service that contains utility methods for handling email functionality such as client-side decryption.
/// </summary>
/// <param name="dbService">The database service.</param>
/// <param name="jsInteropService">The JavaScript interop service.</param>
/// <param name="globalNotificationService">The global notification service.</param>
/// <param name="logger">The logger.</param>
/// <param name="config">The configuration.</param>
public sealed class EmailService(DbService dbService, JsInteropService jsInteropService, GlobalNotificationService globalNotificationService, ILogger<EmailService> logger, Config config)
{
    private List<EncryptionKey> _encryptionKeys = [];

    /// <summary>
    /// Returns true if the email address is from a known SpamOK public domain.
    /// </summary>
    /// <param name="email">The email address to check.</param>
    /// <returns>True if the email address is from a known SpamOK public domain, false otherwise.</returns>
    public bool IsSpamOkDomain(string email)
    {
        return config.PublicEmailDomains.Exists(x => email.EndsWith("@" + x, StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>
    /// Returns true if the email address is from a known AliasVault private domain.
    /// </summary>
    /// <param name="email">The email address to check.</param>
    /// <returns>True if the email address is from a known AliasVault private domain, false otherwise.</returns>
    public bool IsAliasVaultDomain(string email)
    {
        return config.PrivateEmailDomains.Exists(x => email.EndsWith("@" + x, StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>
    /// Returns true if the email address is from a known AliasVault supported domain
    /// of which AliasVault is able to show the email content in the client.
    /// </summary>
    /// <param name="email">The email address to check.</param>
    /// <returns>True if the email address is from a known AliasVault supported domain, false otherwise.</returns>
    public bool IsAliasVaultSupportedDomain(string email)
    {
        return IsSpamOkDomain(email) || IsAliasVaultDomain(email);
    }

    /// <summary>
    /// Decrypts a single email using the private key.
    /// </summary>
    /// <param name="email">The email object with encrypted fields.</param>
    /// <returns>Email with all fields decrypted.</returns>
    public async Task<EmailApiModel> DecryptEmail(EmailApiModel email)
    {
        await EnsureEncryptionKeys();
        return await DecryptSingleEmail(email);
    }

    /// <summary>
    /// Decrypts a list of emails using the private key.
    /// </summary>
    /// <param name="emailList">The email object with encrypted fields.</param>
    /// <returns>List of emails with all fields decrypted.</returns>
    public async Task<List<MailboxEmailApiModel>> DecryptEmailList(List<MailboxEmailApiModel> emailList)
    {
        await EnsureEncryptionKeys();

        foreach (var email in emailList)
        {
            var privateKey = _encryptionKeys.First(x => x.PublicKey == email.EncryptionKey);

            try
            {
                var decryptedSymmetricKeyBase64 = await jsInteropService.DecryptWithPrivateKey(email.EncryptedSymmetricKey, privateKey.PrivateKey);
                email.Subject = await jsInteropService.SymmetricDecrypt(email.Subject, decryptedSymmetricKeyBase64);
                email.FromDisplay = await jsInteropService.SymmetricDecrypt(email.FromDisplay, decryptedSymmetricKeyBase64);
                email.FromLocal = await jsInteropService.SymmetricDecrypt(email.FromLocal, decryptedSymmetricKeyBase64);
                email.FromDomain = await jsInteropService.SymmetricDecrypt(email.FromDomain, decryptedSymmetricKeyBase64);
                email.MessagePreview = await jsInteropService.SymmetricDecrypt(email.MessagePreview, decryptedSymmetricKeyBase64);
            }
            catch (Exception ex)
            {
                globalNotificationService.AddErrorMessage(ex.Message, true);
                logger.LogError(ex, "Error decrypting email list.");
            }
        }

        return emailList;
    }

    /// <summary>
    /// Decrypts an email attachment using the email's encryption key.
    /// </summary>
    /// <param name="email">The email containing the encryption information.</param>
    /// <param name="encryptedBytes">The encrypted attachment bytes.</param>
    /// <returns>Decrypted attachment bytes.</returns>
    public async Task<byte[]?> DecryptEmailAttachment(EmailApiModel email, byte[] encryptedBytes)
    {
        await EnsureEncryptionKeys();
        var privateKey = _encryptionKeys.First(x => x.PublicKey == email.EncryptionKey);

        try
        {
            var decryptedSymmetricKeyBase64 = await jsInteropService.DecryptWithPrivateKey(email.EncryptedSymmetricKey, privateKey.PrivateKey);
            var decryptedBase64 = await jsInteropService.SymmetricDecryptBytes(encryptedBytes, decryptedSymmetricKeyBase64);
            return decryptedBase64;
        }
        catch (Exception ex)
        {
            globalNotificationService.AddErrorMessage(ex.Message, true);
            logger.LogError(ex, "Error decrypting email attachment.");
            return null;
        }
    }

    /// <summary>
    /// Decrypt the contents of a single email.
    /// </summary>
    /// <param name="email">The email object with encrypted fields.</param>
    /// <returns>Email with all fields decrypted.</returns>
    private async Task<EmailApiModel> DecryptSingleEmail(EmailApiModel email)
    {
        var privateKey = _encryptionKeys.First(x => x.PublicKey == email.EncryptionKey);

        try
        {
            var decryptedSymmetricKeyBase64 = await jsInteropService.DecryptWithPrivateKey(email.EncryptedSymmetricKey, privateKey.PrivateKey);
            email.Subject = await jsInteropService.SymmetricDecrypt(email.Subject, decryptedSymmetricKeyBase64);
            if (email.MessageHtml is not null)
            {
                email.MessageHtml = await jsInteropService.SymmetricDecrypt(email.MessageHtml, decryptedSymmetricKeyBase64);
            }

            if (email.MessagePlain is not null)
            {
                email.MessagePlain = await jsInteropService.SymmetricDecrypt(email.MessagePlain, decryptedSymmetricKeyBase64);
            }

            email.FromDisplay = await jsInteropService.SymmetricDecrypt(email.FromDisplay, decryptedSymmetricKeyBase64);
            email.FromLocal = await jsInteropService.SymmetricDecrypt(email.FromLocal, decryptedSymmetricKeyBase64);
            email.FromDomain = await jsInteropService.SymmetricDecrypt(email.FromDomain, decryptedSymmetricKeyBase64);
        }
        catch (Exception ex)
        {
            globalNotificationService.AddErrorMessage(ex.Message, true);
            logger.LogError(ex, "Error decrypting email.");
        }

        return email;
    }

    /// <summary>
    /// Ensure the encryption keys are loaded.
    /// </summary>
    private async Task EnsureEncryptionKeys()
    {
        if (_encryptionKeys.Count == 0)
        {
            var context = await dbService.GetDbContextAsync();
            _encryptionKeys = await context.EncryptionKeys.ToListAsync();
        }
    }
}
