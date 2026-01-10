//-----------------------------------------------------------------------
// <copyright file="EmailDecryptionTests.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.E2ETests.Tests.Client.Shard1;

using System.Text;
using AliasVault.IntegrationTests.SmtpServer;
using MailKit.Net.Smtp;
using MailKit.Security;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Hosting;
using MimeKit;

/// <summary>
/// End-to-end tests for making sure errors and warnings in API are logged to database.
/// </summary>
[TestFixture]
[Category("ClientTests")]
[NonParallelizable]
public class EmailDecryptionTests : ClientPlaywrightTest
{
    /// <summary>
    /// The test host instance.
    /// </summary>
    private IHost _testHost;

    /// <summary>
    /// The test host builder instance.
    /// </summary>
    private TestHostBuilder _testHostBuilder;

    /// <summary>
    /// Setup logic for every test.
    /// </summary>
    /// <returns>Task.</returns>
    [SetUp]
    public async Task Setup()
    {
        // Start the SMTP server test host so we can send emails to it and test encryption/decryption.
        _testHostBuilder = new TestHostBuilder();
        _testHost = _testHostBuilder.Build(ApiDbContext.Database.GetDbConnection());
        await _testHost.StartAsync();
    }

    /// <summary>
    /// Test if received email without attachments encrypted by server can be successfully decrypted by client
    /// and then be deleted by client.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    [Order(1)]
    public async Task EmailEncryptionDecryptionDeleteTest()
    {
        // Create credential which should automatically create claim on server during database sync.
        const string serviceName = "Test Service";
        const string email = "testclaim2@example.tld";
        await CreateItemEntry(new Dictionary<string, string>
        {
            { "service-name", serviceName },
            { "email", email },
        });

        // Assert that the claim was created on the server.
        var claim = await ApiDbContext.UserEmailClaims.Where(x => x.Address == email).FirstOrDefaultAsync();
        Assert.That(claim, Is.Not.Null, "Claim for email address not found in database. Check if item creation and claim creation are working correctly.");

        // Assert that the users public key was created on the server.
        var publicKey = await ApiDbContext.UserEncryptionKeys.Where(x => x.UserId == claim.UserId).FirstOrDefaultAsync();
        Assert.That(publicKey, Is.Not.Null, "Public key for user not found in database. Check if public key creation is working correctly.");
        Assert.That(publicKey.PublicKey, Has.Length.GreaterThanOrEqualTo(100), "Public key exists but length does not match expected. Check if public key creation is working correctly.");

        // Email the SMTP server which will save the email in encrypted form in the database.
        var message = new MimeMessage();
        message.From.Add(new MailboxAddress("Test Sender", "sender@example.com"));
        message.To.Add(new MailboxAddress("Test Recipient", email));
        const string textSubject = "Encrypted Email Subject";
        const string textBody = "This is a test email plain.";
        const string htmlBody = @"
        <html>
        <body>
            <h1>Test Email</h1>
            <p>This is a test email with HTML content.</p>
            <p>Sample anchor tag: <a href=""https://example.com"">Example Link</a></p>
        </body>
        </html>";
        message.Subject = textSubject;
        var bodyBuilder = new BodyBuilder
        {
            TextBody = textBody,
            HtmlBody = htmlBody,
        };
        message.Body = bodyBuilder.ToMessageBody();

        await SendMessageToSmtpServer(message);

        // Assert that email was received by the server.
        var emailReceived = await ApiDbContext.Emails.FirstOrDefaultAsync(x => x.To == email);
        Assert.That(emailReceived, Is.Not.Null, "Email not received by server. Check SMTP server and email encryption/decryption logic.");

        // Assert that subject is not stored as plain text in the database.
        Assert.That(emailReceived.Subject, Does.Not.Contain(textSubject), "Email subject stored as plain text in database. Check email encryption logic.");

        // Attempt to click on email refresh button to get new emails.
        await Page.Locator("id=recent-email-refresh").First.ClickAsync();
        await WaitForUrlAsync("items/**", "Subject");

        // Check if the email is visible on the page now.
        await WaitForUrlAsync("*", textSubject);
        var emailContent = await Page.TextContentAsync("body");
        Assert.That(emailContent, Does.Contain(textSubject), "Email not (correctly) decrypted and displayed on the item page. Check email decryption logic.");

        // Navigate to the email index page and ensure that the decrypted email is also readable there.
        await NavigateUsingBlazorRouter("emails");
        await WaitForUrlAsync("emails", textSubject);

        // Check if the email is visible on the page now.
        emailContent = await Page.TextContentAsync("body");
        Assert.That(emailContent, Does.Contain(textSubject), "Email not (correctly) decrypted and displayed on the emails page. Check email decryption logic.");

        // Attempt to click on the email subject to open the email.
        await Page.Locator("div", new PageLocatorOptions { HasTextString = textSubject }).First.ClickAsync();
        await WaitForUrlAsync("emails**", "Item:");

        // Assert that the anchor tag in the email iframe has target="_blank" attribute.
        var anchorTag = await Page.Locator("iframe").First.GetAttributeAsync("srcdoc");
        Assert.That(anchorTag, Does.Contain("target=\"_blank\""), "Anchor tag in email iframe does not have target=\"_blank\" attribute. Check email decryption logic.");

        // Click the delete button to delete the email.
        await Page.Locator("id=delete-email").First.ClickAsync();

        // Click the confirm button.
        await Page.Locator("id=confirmButton").First.ClickAsync();

        // Wait for the email delete confirm message to show up.
        await WaitForUrlAsync("emails**", "Email deleted successfully");

        // Assert that the email is no longer visible on the page.
        var body = await Page.TextContentAsync("body");
        Assert.That(body, Does.Not.Contain(textSubject), "Email not deleted from page after deletion. Check email deletion logic.");
    }

    /// <summary>
    /// Test if received email including attachment encrypted by server can be successfully decrypted by client
    /// and then be deleted by client.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    [Order(2)]
    public async Task EmailEncryptionDecryptionAttachmentDeleteTest()
    {
        // Create credential which should automatically create claim on server during database sync.
        const string serviceName = "Test Service";
        const string email = "testclaim@example.tld";
        await CreateItemEntry(new Dictionary<string, string>
        {
            { "service-name", serviceName },
            { "email", email },
        });

        // Assert that the claim was created on the server.
        var claim = await ApiDbContext.UserEmailClaims.Where(x => x.Address == email).FirstOrDefaultAsync();
        Assert.That(claim, Is.Not.Null, "Claim for email address not found in database. Check if item creation and claim creation are working correctly.");

        // Assert that the users public key was created on the server.
        var publicKey = await ApiDbContext.UserEncryptionKeys.Where(x => x.UserId == claim.UserId).FirstOrDefaultAsync();
        Assert.That(publicKey, Is.Not.Null, "Public key for user not found in database. Check if public key creation is working correctly.");
        Assert.That(publicKey!.PublicKey, Has.Length.GreaterThanOrEqualTo(100), "Public key exists but length does not match expected. Check if public key creation is working correctly.");

        // Email the SMTP server which will save the email in encrypted form in the database..
        var message = new MimeMessage();
        message.From.Add(new MailboxAddress("Test Sender", "sender@example.com"));
        message.To.Add(new MailboxAddress("Test Recipient", email));
        const string textSubject = "Encrypted Email Subject";
        const string textBody = "This is a test email plain.";
        const string htmlBody = @"
        <html>
        <body>
            <h1>Test Email</h1>
            <p>This is a test email with HTML content.</p>
            <p>Sample anchor tag: <a href=""https://example.com"">Example Link</a></p>
        </body>
        </html>";
        message.Subject = textSubject;
        var bodyBuilder = new BodyBuilder
        {
            TextBody = textBody,
            HtmlBody = htmlBody,
        };
        var attachment = new MimePart("text", "plain")
        {
            Content = new MimeContent(new MemoryStream(Encoding.UTF8.GetBytes("This is an attachment."))),
            ContentDisposition = new ContentDisposition(ContentDisposition.Attachment),
            ContentTransferEncoding = ContentEncoding.Base64,
            FileName = "attachment.txt",
        };
        bodyBuilder.Attachments.Add(attachment);
        message.Body = bodyBuilder.ToMessageBody();

        await SendMessageToSmtpServer(message);

        // Assert that email was received by the server.
        var emailReceived = await ApiDbContext.Emails.FirstOrDefaultAsync(x => x.To == email);
        Assert.That(emailReceived, Is.Not.Null, "Email not received by server. Check SMTP server and email encryption/decryption logic.");

        // Assert that the attachment is stored in the database.
        var attachmentReceived = await ApiDbContext.EmailAttachments.FirstOrDefaultAsync(x => x.EmailId == emailReceived.Id);
        Assert.That(attachmentReceived, Is.Not.Null, "Attachment not found in database. Check email attachment encryption logic.");

        // Assert that the attachment content is encrypted
        var attachmentContent = Encoding.UTF8.GetString(attachmentReceived!.Bytes);
        Assert.Multiple(() =>
        {
            Assert.That(attachmentContent, Does.Not.Contain("This is an attachment."), "Attachment content stored as plain text in database. Check attachment encryption logic.");
            Assert.That(attachmentContent, Is.Not.Empty, "Attachment content is empty. Check attachment encryption logic.");
        });

        // Assert that subject is not stored as plain text in the database.
        Assert.That(emailReceived!.Subject, Does.Not.Contain(textSubject), "Email subject stored as plain text in database. Check email encryption logic.");

        // Attempt to click on email refresh button to get new emails.
        await Page.Locator("id=recent-email-refresh").First.ClickAsync();
        await WaitForUrlAsync("items/**", "Subject");

        // Check if the email is visible on the page now.
        await WaitForUrlAsync("*", textSubject);

        var emailContent = await Page.TextContentAsync("body");
        Assert.That(emailContent, Does.Contain(textSubject), "Email not (correctly) decrypted and displayed on the item page. Check email decryption logic.");

        // Navigate to the email index page and ensure that the decrypted email is also readable there.
        await NavigateUsingBlazorRouter("emails");
        await WaitForUrlAsync("emails", textSubject);

        // Check if the email is visible on the page now.
        emailContent = await Page.TextContentAsync("body");
        Assert.That(emailContent, Does.Contain(textSubject), "Email not (correctly) decrypted and displayed on the emails page. Check email decryption logic.");

        // Assert that the attachment indicator is visible on the page.
        var attachmentIndicator = await Page.Locator(".attachment-indicator").First.GetAttributeAsync("class");
        Assert.That(attachmentIndicator, Is.Not.Null, "Attachment indicator not visible on email page. Check email attachment decryption logic.");

        // Attempt to click on the email subject to open the email.
        await Page.Locator("div", new PageLocatorOptions { HasTextString = textSubject }).First.ClickAsync();
        await WaitForUrlAsync("emails**", "Item:");

        // Assert that the anchor tag in the email iframe has target="_blank" attribute.
        var anchorTag = await Page.Locator("iframe").First.GetAttributeAsync("srcdoc");
        Assert.That(anchorTag, Does.Contain("target=\"_blank\""), "Anchor tag in email iframe does not have target=\"_blank\" attribute. Check email decryption logic.");

        // Assert that email attachment metadata is visible in the modal.
        var body = await Page.TextContentAsync("body");
        Assert.That(body, Does.Contain("attachment.txt"), "Attachment metadata not visible in email modal. Check email attachment parse logic.");

        // Assert that clicking on the attachment link downloads it.
        await Page.Locator(".attachment-link").First.ClickAsync();
        var download = await Page.WaitForDownloadAsync();

        // Get the path of the downloaded file
        var downloadedFilePath = await download.PathAsync();

        // Read the content of the downloaded file
        var downloadedContent = await File.ReadAllBytesAsync(downloadedFilePath);

        // Compare with the original attachment content
        var originalContent = Encoding.UTF8.GetBytes("This is an attachment.");
        Assert.That(downloadedContent, Is.EqualTo(originalContent), "Downloaded attachment content does not match the original content.");

        // Clean up: delete the downloaded file
        File.Delete(downloadedFilePath);

        // Click the delete button to delete the email.
        await Page.Locator("id=delete-email").First.ClickAsync();

        // Click the confirm button.
        await Page.Locator("id=confirmButton").First.ClickAsync();

        // Wait for the email delete confirm message to show up.
        await WaitForUrlAsync("emails**", "Email deleted successfully");

        // Assert that the email is no longer visible on the page.
        body = await Page.TextContentAsync("body");
        Assert.That(body, Does.Not.Contain(textSubject), "Email not deleted from page after deletion. Check email deletion logic.");
    }

    /// <summary>
    /// Test that adding a credential with email domain that is not in the known list to not get added as claim.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    [Order(3)]
    public async Task EmailUnknownDomainNoClaimTest()
    {
        // Create credential which should automatically create claim on server during database sync.
        const string serviceName = "Test Service";
        const string email = "testclaim@unknowndomain.tld";
        await CreateItemEntry(new Dictionary<string, string>
        {
            { "service-name", serviceName },
            { "email", email },
        });

        // Assert that the claim was created on the server.
        var claim = await ApiDbContext.UserEmailClaims.FirstOrDefaultAsync(x => x.Address == email);

        Assert.That(claim, Is.Null, "Claim for unknown email address domain found in database. Check if claim creation domain check is working correctly.");
    }

    /// <summary>
    /// Test that a user cannot claim an email address that is already claimed by another user.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    [Order(4)]
    public async Task EmailDuplicateClaimTest()
    {
        // Create credential which should automatically create claim on server during database sync.
        const string serviceName = "Test Service";
        const string email = "testclaimduplicate@example.tld";
        await CreateItemEntry(new Dictionary<string, string>
        {
            { "service-name", serviceName },
            { "email", email },
        });

        // Assert that the claim was created on the server.
        var claim = await ApiDbContext.UserEmailClaims.FirstOrDefaultAsync(x => x.Address == email);
        Assert.That(claim, Is.Not.Null, "Claim for email address not found in database. Check if item creation and claim creation are working correctly.");

        // Login as new user.
        await LogoutAndLoginAsNewUser();

        // Try to claim the same email address again.
        await CreateItemEntry(new Dictionary<string, string>
        {
            { "service-name", serviceName },
            { "email", email },
        });

        // Assert that still only one claim exists for the email address.
        var claimCount = await ApiDbContext.UserEmailClaims.CountAsync(x => x.Address == email);
        Assert.That(
            claimCount,
            Is.LessThanOrEqualTo(1),
            "More than one claim for email address found in database while only one should exist. Check if claim creation domain check is working correctly.");

        // Assert that error is displayed on the page.
        await WaitForUrlAsync("*", "The current chosen email address is already in use");
    }

    /// <summary>
    /// Test that when a user deletes an alias, the email claim gets disabled in the database.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    [Order(5)]
    public async Task EmailClaimDeleteDisableTest()
    {
        // Create two credential which should automatically create claims on server during database sync.
        const string serviceName1 = "Test 1 Service";
        const string email1 = "testclaimdisabled@example.tld";
        await CreateItemEntry(new Dictionary<string, string>
        {
            { "service-name", serviceName1 },
            { "email", email1 },
        });

        // Create credential which should automatically create claim on server during database sync.
        const string serviceName2 = "Test 2 Service";
        const string email2 = "testclaimenabled@example.tld";
        await CreateItemEntry(new Dictionary<string, string>
        {
            { "service-name", serviceName2 },
            { "email", email2 },
        });

        // Assert that both claims were created on the server.
        var claim1 = await ApiDbContext.UserEmailClaims.AsNoTracking().FirstOrDefaultAsync(x => x.Address == email1);
        var claim2 = await ApiDbContext.UserEmailClaims.AsNoTracking().FirstOrDefaultAsync(x => x.Address == email2);
        Assert.Multiple(() =>
        {
            Assert.That(claim1, Is.Not.Null, "Claim for email address not found in database. Check if item creation and claim creation are working correctly.");
            Assert.That(claim2, Is.Not.Null, "Claim for email address not found in database. Check if item creation and claim creation are working correctly.");
        });

        // Assert that both claims are not disabled.
        Assert.Multiple(() =>
        {
            Assert.That(claim1.Disabled, Is.False, "Claim for new email address is marked disabled after creation.");
            Assert.That(claim2.Disabled, Is.False, "Claim for new email address is marked disabled after creation.");
        });

        // Delete the first credential.
        await DeleteItemEntry(serviceName1);

        // Wait for background sync to complete (delete uses background sync).
        await Task.Delay(1000);

        // Assert that the first claim is now disabled, and second still enabled.
        claim1 = await ApiDbContext.UserEmailClaims.AsNoTracking().FirstAsync(x => x.Address == email1);
        claim2 = await ApiDbContext.UserEmailClaims.AsNoTracking().FirstAsync(x => x.Address == email2);
        Assert.Multiple(() =>
        {
            Assert.That(claim1.Disabled, Is.True, "Claim for deleted alias is not marked as disabled after deletion.");
            Assert.That(claim2.Disabled, Is.False, "Claim for existing email address is marked disabled after deleting another claim.");
        });

        // Create a new credential with the same email as the one that was disabled.
        await CreateItemEntry(new Dictionary<string, string>
        {
            { "service-name", serviceName1 },
            { "email", email1 },
        });

        // Assert that the first email claim is enabled again.
        claim1 = await ApiDbContext.UserEmailClaims.AsNoTracking().FirstAsync(x => x.Address == email1);
        Assert.That(claim1.Disabled, Is.False, "Claim is not marked as (re)enabled when user re-claims it after having previously deleted it.");
    }

    /// <summary>
    /// Tear down logic for every test.
    /// </summary>
    /// <returns>Task.</returns>
    [TearDown]
    public async Task TearDown()
    {
        await _testHost.StopAsync();
        _testHost.Dispose();
        await _testHostBuilder.DisposeAsync();
    }

    /// <summary>
    /// Sends a message to the SMTP server.
    /// </summary>
    /// <param name="message">MimeMessage to send.</param>
    private static async Task SendMessageToSmtpServer(MimeMessage message)
    {
        using var client = new SmtpClient();

        await client.ConnectAsync("localhost", 2525, SecureSocketOptions.None);
        try
        {
            await client.SendAsync(message);
        }
        finally
        {
            await client.DisconnectAsync(true);
        }
    }
}
