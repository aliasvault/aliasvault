//-----------------------------------------------------------------------
// <copyright file="DatabaseMessageStore.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.SmtpService.Handlers;

using System.Buffers;
using System.Net.Mail;
using System.Text.RegularExpressions;
using AliasServerDb;
using AliasVault.Cryptography.Server;
using Microsoft.EntityFrameworkCore;
using MimeKit;
using NUglify;
using SmtpServer;
using SmtpServer.Mail;
using SmtpServer.Protocol;
using SmtpServer.Storage;

/// <summary>
/// Database message store.
/// </summary>
/// <param name="logger">ILogger instance.</param>
/// <param name="config">Config instance.</param>
/// <param name="dbContextFactory">IDbContextFactory instance.</param>
public class DatabaseMessageStore(ILogger<DatabaseMessageStore> logger, Config config, IAliasServerDbContextFactory dbContextFactory) : MessageStore
{
    /// <summary>
    /// Override the SaveAsync method to save the email into the database.
    /// </summary>
    /// <param name="context">ISessionContext instance.</param>
    /// <param name="transaction">IMessageTransaction instance.</param>
    /// <param name="buffer">Buffer which contains the email contents.</param>
    /// <param name="cancellationToken">CancellationToken instance.</param>
    /// <returns>SmtpResponse.</returns>
    public override async Task<SmtpResponse> SaveAsync(ISessionContext context, IMessageTransaction transaction, ReadOnlySequence<byte> buffer, CancellationToken cancellationToken)
    {
        try
        {
            // Check email size limit
            var maxEmailSizeInMegabytes = 10;
            var maxEmailSizeInBytes = (long)((maxEmailSizeInMegabytes * 1024 * 1024) * 1.4);
            if (buffer.Length > maxEmailSizeInBytes)
            {
                return SmtpResponse.SizeLimitExceeded;
            }

            var message = await LoadMessageFromBuffer(buffer, cancellationToken);

            // Retrieve all addresses from the SMTP transaction which should contain all recipients for this mail instance.
            var allAddresses = transaction.To
                .Distinct()
                .ToList();

            // Limit list to 15 addresses maximum to prevent mailbomb/spam abuse.
            var toAddresses = allAddresses.Take(15).ToList();

            var toAddressesCount = toAddresses.Count;
            var toAddressesFailCount = 0;
            foreach (var toAddress in toAddresses)
            {
                // Process the email for each recipient separately.
                var process = await ProcessEmailForRecipient(message, toAddress);
                if (!process)
                {
                    toAddressesFailCount++;
                }

                // If all recipients failed, return error to sender.
                if (toAddressesFailCount == toAddressesCount)
                {
                    // No valid recipients given.
                    logger.LogDebug("No valid recipients in email, returning error to sender.");
                    return SmtpResponse.NoValidRecipientsGiven;
                }
            }

            return SmtpResponse.Ok;
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error saving email into database.");
            return SmtpResponse.MailboxUnavailable;
        }
    }

    /// <summary>
    /// Load the email message from the buffer.
    /// </summary>
    /// <param name="buffer">Buffer which contains the email contents.</param>
    /// <param name="cancellationToken">CancellationToken instance.</param>
    /// <returns>MimeMessage.</returns>
    private static async Task<MimeMessage> LoadMessageFromBuffer(ReadOnlySequence<byte> buffer, CancellationToken cancellationToken)
    {
        await using var stream = new MemoryStream();

        var position = buffer.GetPosition(0);
        while (buffer.TryGet(ref position, out var memory))
        {
            stream.Write(memory.Span);
        }

        stream.Position = 0;
        return await MimeMessage.LoadAsync(stream, cancellationToken);
    }

    /// <summary>
    /// Convert MimeMessage to Email database object.
    /// </summary>
    /// <param name="message">MimeMessage object.</param>
    /// <param name="toAddress">The recipient for this mail.</param>
    /// <returns>Email object.</returns>
    private static Email ConvertMimeMessageToEmail(MimeMessage message, MailAddress toAddress)
    {
        var from = string.Empty;

        try
        {
            from = message.From.FirstOrDefault()?.ToString() ?? string.Empty;
        }
        catch
        {
            // Do nothing.
        }

        string fromLocal;
        string fromDomain;

        // Try to extract from address firstly from "from" in the mail.
        try
        {
            MailAddress fromAddress = new MailAddress(message.From.FirstOrDefault()?.ToString() ?? string.Empty);
            fromLocal = fromAddress.User;
            fromDomain = fromAddress.Host;
        }
        catch
        {
            // If this fails, then simply use a blank value.
            fromLocal = string.Empty;
            fromDomain = string.Empty;
        }

        // Create email object.
        var email = new Email
        {
            From = from,
            FromLocal = fromLocal.ToLower(),
            FromDomain = fromDomain.ToLower(),
            To = toAddress.Address.ToLower(),
            ToLocal = toAddress.User.ToLower(),
            ToDomain = toAddress.Host.ToLower(),
            Subject = message.Subject ?? string.Empty,
            MessageHtml = message.HtmlBody,
            MessagePlain = message.TextBody,
            MessageSource = message.ToString(),
            Date = message.Date.DateTime.ToUniversalTime(),
            DateSystem = DateTime.UtcNow,
            Visible = true,
        };

        // Extract a preview of the email message body to be used in the email listing preview in the UI.
        email.MessagePreview = ExtractMessagePreview(email);

        // Parse attachments from email, and create separate attachment records in database for each attachment.
        foreach (var attachment in message.Attachments)
        {
            var emailAttachment = CreateEmailAttachment(attachment);
            email.Attachments.Add(emailAttachment);
        }

        return email;
    }

    /// <summary>
    /// Extracts a preview of the email message body to be used in the email listing preview in the UI.
    /// This so the client does not need to load the full email body.
    /// </summary>
    /// <param name="email">Email to extract preview for.</param>
    /// <returns>Email preview as string.</returns>
    private static string ExtractMessagePreview(Email email)
    {
        var messagePreview = string.Empty;
        const int maxPreviewLength = 180;

        try
        {
            if (email.MessagePlain != null && !string.IsNullOrEmpty(email.MessagePlain) && email.MessagePlain.Length > 3)
            {
                // Decode HTML entities (e.g., &#39; -> ', &amp; -> &)
                string plainToPlainText = System.Net.WebUtility.HtmlDecode(email.MessagePlain);

                // Replace any newline characters with a space
                plainToPlainText = Regex.Replace(plainToPlainText, @"\t|\n|\r", " ", RegexOptions.NonBacktracking);

                // Remove all "-" or "=" characters if there are 3 or more in a row
                plainToPlainText = Regex.Replace(plainToPlainText, @"-{3,}|\={3,}", string.Empty, RegexOptions.NonBacktracking);

                // Remove any non-printable characters
                plainToPlainText = Regex.Replace(plainToPlainText, @"[^\u0020-\u007E]", string.Empty, RegexOptions.NonBacktracking);

                // Replace multiple spaces with a single space
                plainToPlainText = Regex.Replace(plainToPlainText, @"\s+", " ", RegexOptions.NonBacktracking);

                // Trim start and end of string
                plainToPlainText = plainToPlainText.Trim();

                messagePreview = plainToPlainText.Length > maxPreviewLength
                    ? plainToPlainText.Substring(0, maxPreviewLength)
                    : plainToPlainText;
            }
            else if (email.MessageHtml != null)
            {
                string htmlToPlainText = Uglify.HtmlToText(email.MessageHtml).ToString();

                // Decode HTML entities (e.g., &#39; -> ', &amp; -> &)
                htmlToPlainText = System.Net.WebUtility.HtmlDecode(htmlToPlainText);

                // Replace any newline characters with a space
                htmlToPlainText = Regex.Replace(htmlToPlainText, @"\t|\n|\r", string.Empty, RegexOptions.NonBacktracking);

                // Remove all "-" or "=" characters if there are 3 or more in a row
                htmlToPlainText = Regex.Replace(htmlToPlainText, @"-{3,}|\={3,}", string.Empty, RegexOptions.NonBacktracking);

                // Remove any non-printable characters
                htmlToPlainText = Regex.Replace(htmlToPlainText, @"[^\u0020-\u007E]", string.Empty, RegexOptions.NonBacktracking);

                // Replace multiple spaces with a single space
                htmlToPlainText = Regex.Replace(htmlToPlainText, @"\s+", " ", RegexOptions.NonBacktracking);

                // Trim start and end of string
                htmlToPlainText = htmlToPlainText.Trim();

                messagePreview =
                    htmlToPlainText.Length > maxPreviewLength ? htmlToPlainText.Substring(0, maxPreviewLength) : htmlToPlainText;
            }
        }
        catch
        {
            // Extracting useful words from email failed. Skip the step, do nothing.
        }

        return messagePreview;
    }

    /// <summary>
    /// Create an EmailAttachment object from a MimeEntity attachment.
    /// </summary>
    /// <param name="attachment">MimeEntity attachment.</param>
    /// <returns>EmailAttachment object.</returns>
    private static EmailAttachment CreateEmailAttachment(MimeEntity attachment)
    {
        byte[] fileBytes = GetAttachmentBytes(attachment);

        return new EmailAttachment
        {
            Bytes = fileBytes,
            Filename = attachment.ContentDisposition?.FileName ?? string.Empty,
            MimeType = attachment.ContentType.MimeType,
            Filesize = fileBytes.Length,
            Date = DateTime.UtcNow,
        };
    }

    /// <summary>
    /// Get the attachment bytes from a MimeEntity attachment.
    /// </summary>
    /// <param name="attachment">MimeEntity attachment.</param>
    /// <returns>Attachment byte array.</returns>
    private static byte[] GetAttachmentBytes(MimeEntity attachment)
    {
        using var memory = new MemoryStream();

        if (attachment is MimePart mimePartAttachment)
        {
            mimePartAttachment.Content.DecodeTo(memory);
        }
        else
        {
            ((MessagePart)attachment).Message.WriteTo(memory);
        }

        return memory.ToArray();
    }

    /// <summary>
    /// Process email for recipient separately.
    /// </summary>
    /// <param name="message">MimeMessage.</param>
    /// <param name="toAddress">ToAddress.</param>
    /// <returns>True if success or silent skip, false if SmtpResponse.NoValidRecipientsGiven should be triggered.</returns>
    private async Task<bool> ProcessEmailForRecipient(MimeMessage message, IMailbox? toAddress)
    {
        // Check if toAddress domain is allowed.
        if (toAddress is null || !config.AllowedToDomains.Contains(toAddress.Host.ToLowerInvariant()))
        {
            // ToAddress domain is not allowed.
            logger.LogInformation(
                "Rejected email: email for {ToAddress} is not allowed. Domain not in allowed domain list.",
                toAddress?.User + "@" + toAddress?.Host);
            return false;
        }

        // Check if the local part of the toAddress is a known alias (claimed by a user)
        await using var dbContext = await dbContextFactory.CreateDbContextAsync(CancellationToken.None);
        var toAddressLocal = toAddress.User.ToLowerInvariant();
        var toAddressDomain = toAddress.Host.ToLowerInvariant();
        var userEmailClaim = await dbContext.UserEmailClaims
            .FirstOrDefaultAsync(
                x =>
                    x.AddressLocal == toAddressLocal &&
                    x.AddressDomain == toAddressDomain,
                CancellationToken.None);

        if (userEmailClaim is null)
        {
            // Email address has no user claim with corresponding encryption key, so we cannot process it.
            logger.LogInformation(
                "Rejected email: email for {ToAddress} is not allowed. No user claim on this ToAddress.",
                toAddress.User + "@" + toAddress.Host);
            return false;
        }

        if (userEmailClaim.UserId is null)
        {
            // This email claim has no user attached to it (anymore), which most likely means the user has deleted
            // its account. We cannot process this email.
            logger.LogInformation(
                "Rejected email: email for {ToAddress} is claimed but has no user associated with it. User has most likely deleted their account.",
                toAddress.User + "@" + toAddress.Host);
            return false;
        }

        // Check if the email claim is disabled.
        if (userEmailClaim.Disabled)
        {
            // Email claim is disabled, so we cannot process this email.
            logger.LogInformation(
                "Rejected email: email for {ToAddress} is claimed but is disabled which means the user has deleted the email alias.",
                toAddress.User + "@" + toAddress.Host);
            return false;
        }

        // Retrieve user public encryption key from database
        var userPublicKey = await dbContext.UserEncryptionKeys.FirstOrDefaultAsync(
            x =>
            x.UserId == userEmailClaim.UserId && x.IsPrimary,
            CancellationToken.None);

        if (userPublicKey is null)
        {
            // Email address has no user claim with corresponding encryption key, so we cannot process it.
            logger.LogCritical(
                "Rejected email: email for {ToAddress} cannot be processed. No primary encryption key found for this user.",
                toAddress.User + "@" + toAddress.Host);
            return false;
        }

        var insertedId = await InsertEmailIntoDatabase(message, new MailAddress(toAddress.AsAddress()), userPublicKey);
        logger.LogDebug(
            "Email for {ToAddress} successfully saved into database with ID {InsertedId}.",
            toAddress.User + "@" + toAddress.Host,
            insertedId);
        return true;
    }

    /// <summary>
    /// Insert email into database.
    /// </summary>
    /// <param name="message">MimeMessage to save into database.</param>
    /// <param name="toAddress">The recipient for this mail.</param>
    /// <param name="userEncryptionKey">The public key of the user to encrypt the mail contents with.</param>
    private async Task<int> InsertEmailIntoDatabase(MimeMessage message, MailAddress toAddress, UserEncryptionKey userEncryptionKey)
    {
        await using var dbContext = await dbContextFactory.CreateDbContextAsync();

        var newEmail = ConvertMimeMessageToEmail(message, toAddress);
        newEmail = EmailEncryption.EncryptEmail(newEmail, userEncryptionKey);

        // Insert the email into the database.
        dbContext.Emails.Add(newEmail);

        // Increment the user's EmailsReceived counter (persistent counter for abuse detection)
        var user = await dbContext.AliasVaultUsers.FindAsync(userEncryptionKey.UserId);
        if (user != null)
        {
            user.EmailsReceived++;
        }

        await dbContext.SaveChangesAsync();

        return newEmail.Id;
    }
}
