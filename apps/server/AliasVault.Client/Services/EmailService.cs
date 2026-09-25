//-----------------------------------------------------------------------
// <copyright file="EmailService.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Services;

using System.Net.Http.Json;
using System.Text;
using AliasClientDb;
using AliasVault.Client.Main.Models;
using AliasVault.Client.Services.JsInterop.RustCore;
using AliasVault.Shared.Core;
using AliasVault.Shared.Models.WebApi.V2.Email;
using Microsoft.EntityFrameworkCore;

/// <summary>
/// Email service that loads emails from the API and turns them into the model the UI renders.
/// </summary>
/// <param name="dbService">The database service.</param>
/// <param name="jsInteropService">The JavaScript interop service.</param>
/// <param name="rustCoreService">The Rust core service used to parse the message source.</param>
/// <param name="httpClient">The API HTTP client.</param>
/// <param name="httpClientFactory">The HTTP client factory, used for calls to the external SpamOK API.</param>
/// <param name="logger">The logger.</param>
/// <param name="config">The configuration.</param>
public sealed class EmailService(DbService dbService, JsInteropService jsInteropService, RustCoreService rustCoreService, HttpClient httpClient, IHttpClientFactory httpClientFactory, ILogger<EmailService> logger, Config config)
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
    /// Loads a single email from the AliasVault API and decrypts it for display.
    /// </summary>
    /// <param name="emailId">The ID of the email to load.</param>
    /// <returns>The email ready for display, or null if it could not be loaded or decrypted.</returns>
    public async Task<EmailViewModel?> LoadEmailAsync(int emailId)
    {
        var email = await httpClient.GetFromJsonAsync<EmailApiModel>(ApiRoute($"Email/{emailId}"));
        if (email is null)
        {
            return null;
        }

        await EnsureEncryptionKeys();

        var symmetricKey = await ResolveSymmetricKeyAsync(email.DecryptionKeys, email.PublicKeys);
        if (symmetricKey is null)
        {
            logger.LogWarning("Skipping email {EmailId}, no local encryption key can open it.", email.Id);
            return null;
        }

        var view = new EmailViewModel
        {
            Id = email.Id,
            Subject = await jsInteropService.SymmetricDecrypt(email.Subject, symmetricKey),
            FromDisplay = await jsInteropService.SymmetricDecrypt(email.FromDisplay, symmetricKey),
            FromLocal = await jsInteropService.SymmetricDecrypt(email.FromLocal, symmetricKey),
            FromDomain = await jsInteropService.SymmetricDecrypt(email.FromDomain, symmetricKey),
            ToLocal = email.ToLocal,
            ToDomain = email.ToDomain,
            DateSystem = email.DateSystem,
            SymmetricKey = symmetricKey,
        };

        if (!string.IsNullOrEmpty(email.MessageSource))
        {
            view.SourceBytes = await jsInteropService.SymmetricDecryptBase64ToBytes(email.MessageSource, symmetricKey);
            await ParseSourceIntoAsync(view);
        }

        return view;
    }

    /// <summary>
    /// Loads a single email from the external SpamOK API for display.
    /// </summary>
    /// <param name="emailPrefix">The local part of the SpamOK mailbox address.</param>
    /// <param name="emailId">The ID of the email to load.</param>
    /// <returns>The email ready for display, or null if it could not be loaded.</returns>
    public async Task<EmailViewModel?> LoadSpamOkEmailAsync(string emailPrefix, int emailId)
    {
        var response = await SendSpamOkRequestAsync(HttpMethod.Get, $"Email/{emailPrefix}/{emailId}");
        if (!response.IsSuccessStatusCode)
        {
            return null;
        }

        var email = await response.Content.ReadFromJsonAsync<AliasVault.Shared.Models.Spamok.EmailApiModel>();
        if (email is null)
        {
            return null;
        }

        return new EmailViewModel
        {
            Id = email.Id,
            Subject = email.Subject,
            FromDisplay = email.FromDisplay,
            FromLocal = email.FromLocal,
            FromDomain = email.FromDomain,
            ToLocal = email.ToLocal,
            ToDomain = email.ToDomain,
            DateSystem = email.DateSystem,
            IsSpamOk = true,
            HtmlBody = email.MessageHtml,
            TextBody = email.MessagePlain,
            SourceText = email.MessageSource,
            Attachments = email.Attachments.ConvertAll(x => new EmailAttachmentViewModel
            {
                Filename = x.Filename,
                MimeType = x.MimeType,
                Size = x.Filesize,
                SpamOkId = x.Id,
            }),
        };
    }

    /// <summary>
    /// Decrypts the metadata of a list of mailbox emails. Emails that no local key can open are skipped rather
    /// than failing the whole list.
    /// </summary>
    /// <param name="emailList">The emails with encrypted fields.</param>
    /// <param name="publicKeys">The public key table the decryption keys of the emails reference by index.</param>
    /// <returns>The emails that could be decrypted.</returns>
    public async Task<List<MailboxEmailApiModel>> DecryptEmailList(List<MailboxEmailApiModel> emailList, List<string> publicKeys)
    {
        await EnsureEncryptionKeys();

        var decrypted = new List<MailboxEmailApiModel>(emailList.Count);
        foreach (var email in emailList)
        {
            var symmetricKey = await ResolveSymmetricKeyAsync(email.DecryptionKeys, publicKeys);
            if (symmetricKey is null)
            {
                logger.LogWarning("Skipping email {EmailId}, no local encryption key can open it.", email.Id);
                continue;
            }

            try
            {
                email.Subject = await jsInteropService.SymmetricDecrypt(email.Subject, symmetricKey);
                email.FromDisplay = await jsInteropService.SymmetricDecrypt(email.FromDisplay, symmetricKey);
                email.FromLocal = await jsInteropService.SymmetricDecrypt(email.FromLocal, symmetricKey);
                email.FromDomain = await jsInteropService.SymmetricDecrypt(email.FromDomain, symmetricKey);
                email.MessagePreview = await jsInteropService.SymmetricDecrypt(email.MessagePreview, symmetricKey);
                decrypted.Add(email);
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Skipping email {EmailId}, it could not be decrypted.", email.Id);
            }
        }

        return decrypted;
    }

    /// <summary>
    /// Returns the raw message source as text, decoding it the first time the source view asks for it.
    /// </summary>
    /// <param name="email">The email to get the source of.</param>
    /// <returns>The message source, or an empty string when the email carries none.</returns>
    public async Task<string> GetSourceTextAsync(EmailViewModel email)
    {
        if (email.SourceText is not null)
        {
            return email.SourceText;
        }

        if (email.SourceBytes is null)
        {
            return string.Empty;
        }

        try
        {
            email.SourceText = Encoding.UTF8.GetString(await rustCoreService.DecodeEmailSourceAsync(email.SourceBytes));
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Could not decode the source of email {EmailId}.", email.Id);
            return string.Empty;
        }

        return email.SourceText;
    }

    /// <summary>
    /// Gets the decoded bytes of an attachment so they can be offered to the user as a download.
    /// </summary>
    /// <param name="email">The email the attachment belongs to.</param>
    /// <param name="attachment">The attachment to get the bytes of.</param>
    /// <returns>The attachment bytes, or null if they could not be retrieved.</returns>
    public async Task<byte[]?> GetAttachmentBytesAsync(EmailViewModel email, EmailAttachmentViewModel attachment)
    {
        if (email.IsSpamOk)
        {
            var response = await SendSpamOkRequestAsync(HttpMethod.Get, $"Attachment/{email.Id}/{attachment.SpamOkId}/download");
            return response.IsSuccessStatusCode ? await response.Content.ReadAsByteArrayAsync() : null;
        }

        if (email.SourceBytes is null)
        {
            return null;
        }

        // An attachment whose body the server detached at ingest carries no bytes in the source; its body is
        // fetched and decrypted separately and spliced back in by the parser.
        byte[]? detachedBody = null;
        if (attachment.PartIndex is not null)
        {
            var response = await httpClient.GetAsync(ApiRoute($"Email/{email.Id}/parts/{attachment.PartIndex}"));
            if (!response.IsSuccessStatusCode || email.SymmetricKey is null)
            {
                return null;
            }

            detachedBody = await jsInteropService.SymmetricDecryptBytes(await response.Content.ReadAsByteArrayAsync(), email.SymmetricKey);
        }

        return await rustCoreService.ExtractEmailAttachmentAsync(email.SourceBytes, attachment.Index, detachedBody);
    }

    /// <summary>
    /// Parse the bodies and attachment metadata out of the decrypted message source of an email.
    /// </summary>
    /// <param name="email">The email whose source was decrypted.</param>
    /// <returns>Task.</returns>
    private async Task ParseSourceIntoAsync(EmailViewModel email)
    {
        try
        {
            var parsed = await rustCoreService.ParseEmailSourceAsync(email.SourceBytes!);
            email.HtmlBody = parsed.HtmlBody;
            email.TextBody = parsed.TextBody;
            email.Attachments = [.. parsed.Attachments.Select((attachment, index) => new EmailAttachmentViewModel
            {
                Filename = attachment.Filename,
                MimeType = attachment.MimeType,
                Size = attachment.Size,
                Index = index,
                PartIndex = attachment.PartIndex,
            })];
        }
        catch (Exception ex)
        {
            // A parse failure costs the bodies, not the email: the raw source view still renders without the parser.
            logger.LogWarning(ex, "Could not parse the source of email {EmailId}.", email.Id);
        }
    }

    /// <summary>
    /// Decrypts the symmetric key of an email with the first locally held keypair that one of its decryption
    /// keys names. An email carries one decryption key per manifest keypair the caller holds, each naming its
    /// public key by index into the public key table the API sends once per response.
    /// </summary>
    /// <param name="decryptionKeys">The decryption keys of the email.</param>
    /// <param name="publicKeys">The public key table of the response.</param>
    /// <returns>The symmetric key as base64, or null if no local keypair can open the email.</returns>
    private async Task<string?> ResolveSymmetricKeyAsync(List<EmailDecryptionKeyApiModel> decryptionKeys, List<string> publicKeys)
    {
        foreach (var decryptionKey in decryptionKeys)
        {
            if (decryptionKey.KeyIndex < 0 || decryptionKey.KeyIndex >= publicKeys.Count)
            {
                continue;
            }

            var encryptionKey = _encryptionKeys.Find(x => x.PublicKey == publicKeys[decryptionKey.KeyIndex]);
            if (encryptionKey is null)
            {
                continue;
            }

            return await jsInteropService.DecryptWithPrivateKey(decryptionKey.EncryptedSymmetricKey, encryptionKey.PrivateKey);
        }

        return null;
    }

    /// <summary>
    /// Send a request to the external SpamOK API.
    /// </summary>
    /// <param name="method">The HTTP method.</param>
    /// <param name="path">The request path relative to the SpamOK API root.</param>
    /// <returns>The response.</returns>
    private async Task<HttpResponseMessage> SendSpamOkRequestAsync(HttpMethod method, string path)
    {
        var client = httpClientFactory.CreateClient("EmailClient");
        var request = new HttpRequestMessage(method, $"https://api.spamok.com/v2/{path}");
        request.Headers.Add("X-Asdasd-Platform-Id", "av-web");
        request.Headers.Add("X-Asdasd-Platform-Version", AppInfo.GetFullVersion());

        return await client.SendAsync(request);
    }

    /// <summary>
    /// Ensure the encryption keys are loaded.
    /// </summary>
    /// <returns>Task.</returns>
    private async Task EnsureEncryptionKeys()
    {
        if (_encryptionKeys.Count == 0)
        {
            var context = await dbService.GetDbContextAsync();
            _encryptionKeys = await context.EncryptionKeys.ToListAsync();
        }
    }
}
