//-----------------------------------------------------------------------
// <copyright file="AttachmentTests.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.E2ETests.Tests.Client.Shard5;

/// <summary>
/// End-to-end tests for uploading and downloading attachments.
/// </summary>
[Parallelizable(ParallelScope.Self)]
[Category("ClientTests")]
[TestFixture]
public class AttachmentTests : ClientPlaywrightTest
{
    /// <summary>
    /// Test that adding an attachment works correctly and can be downloaded afterwards.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    [Order(1)]
    public async Task UploadAndDownloadAttachment()
    {
        // Create a new alias with service name = "Test Service".
        var serviceName = "Test Service";
        await CreateItemEntry(
            new Dictionary<string, string>
            {
                { "service-name", serviceName },
            },
            async () =>
            {
                // Add the attachments section via the + menu
                await AddFieldSectionAsync("Attachments");

                // Wait for the file input to appear
                await Page.WaitForSelectorAsync("input[type='file']");

                // Upload file.
                var fileInput = Page.Locator("input[type='file']");
                var fileContent = await ResourceReaderUtility.ReadEmbeddedResourceBytesAsync("AliasVault.E2ETests.TestData.TestAttachment.txt");

                // Create a temporary file with the content and original file name
                var originalFileName = "TestAttachment.txt";
                var tempFilePath = Path.Combine(Path.GetTempPath(), originalFileName);
                await File.WriteAllBytesAsync(tempFilePath, fileContent);

                // Set the file input using the temporary file
                await fileInput.SetInputFilesAsync(tempFilePath);

                // Delete the temporary file
                File.Delete(tempFilePath);
            });

        // Check that the attachment name appears on the alias page.
        var pageContent = await Page.TextContentAsync("body");
        Assert.That(pageContent, Does.Contain("TestAttachment.txt"), "Uploaded attachment name does not appear on alias page.");

        // Download the attachment
        var downloadPromise = Page.WaitForDownloadAsync();
        await Page.ClickAsync("text=TestAttachment.txt");
        var download = await downloadPromise;

        // Get the path of the downloaded file
        var downloadedFilePath = await download.PathAsync();

        // Read the content of the downloaded file
        var downloadedContent = await File.ReadAllBytesAsync(downloadedFilePath);

        // Compare the downloaded content with the original file content
        var originalContent = await ResourceReaderUtility.ReadEmbeddedResourceBytesAsync("AliasVault.E2ETests.TestData.TestAttachment.txt");
        Assert.That(downloadedContent, Is.EqualTo(originalContent), "Downloaded file content does not match the original file content.");

        // Clean up: delete the downloaded file
        File.Delete(downloadedFilePath);
    }

    /// <summary>
    /// Test that updating a credential with an existing attachment works correctly.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    [Order(2)]
    public async Task UpdateCredentialWithAttachment()
    {
        // Create a new alias with service name = "Test Service".
        var serviceName = "Test Service";
        var initialUsername = "initialuser";
        await CreateItemEntry(
            new Dictionary<string, string>
            {
                { "service-name", serviceName },
                { "username", initialUsername },
            },
            async () =>
            {
                // Add the attachments section via the + menu
                await AddFieldSectionAsync("Attachments");

                // Wait for the file input to appear
                await Page.WaitForSelectorAsync("input[type='file']");

                // Upload file.
                var fileInput = Page.Locator("input[type='file']");
                var fileContent = await ResourceReaderUtility.ReadEmbeddedResourceBytesAsync("AliasVault.E2ETests.TestData.TestAttachment.txt");

                // Create a temporary file with the content and original file name
                var originalFileName = "TestAttachment.txt";
                var tempFilePath = Path.Combine(Path.GetTempPath(), originalFileName);
                await File.WriteAllBytesAsync(tempFilePath, fileContent);

                // Set the file input using the temporary file
                await fileInput.SetInputFilesAsync(tempFilePath);

                // Delete the temporary file
                File.Delete(tempFilePath);
            });

        // Check that the attachment name appears on the alias page.
        var pageContent = await Page.TextContentAsync("body");
        Assert.That(pageContent, Does.Contain("TestAttachment.txt"), "Uploaded attachment name does not appear on alias page.");

        // Update the credential
        var updatedUsername = "updateduser";
        await UpdateItemEntry(serviceName, new Dictionary<string, string>
        {
            { "username", updatedUsername },
        });

        // Check that the updated username and attachment name still appear on the item page.
        var usernameElement = await Page.QuerySelectorAsync("#login-username");
        Assert.That(usernameElement, Is.Not.Null, "Username element not found.");
        Assert.That(await usernameElement.InputValueAsync(), Is.EqualTo(updatedUsername), "Updated username does not appear on alias page.");

        pageContent = await Page.TextContentAsync("body");
        Assert.That(pageContent, Does.Contain("TestAttachment.txt"), "Attachment name does not appear on alias page after update.");

        // Download the attachment
        var downloadPromise = Page.WaitForDownloadAsync();
        await Page.ClickAsync("text=TestAttachment.txt");
        var download = await downloadPromise;

        // Get the path of the downloaded file
        var downloadedFilePath = await download.PathAsync();

        // Read the content of the downloaded file
        var downloadedContent = await File.ReadAllBytesAsync(downloadedFilePath);

        // Compare the downloaded content with the original file content
        var originalContent = await ResourceReaderUtility.ReadEmbeddedResourceBytesAsync("AliasVault.E2ETests.TestData.TestAttachment.txt");
        Assert.That(downloadedContent, Is.EqualTo(originalContent), "Downloaded file content does not match the original file content after update.");

        // Clean up: delete the downloaded file
        File.Delete(downloadedFilePath);
    }

    /// <summary>
    /// Test that uploading and deleting an attachment works correctly.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    [Order(3)]
    public async Task UploadAndDeleteAttachment()
    {
        // Create a new alias with service name = "Test Service for Deletion".
        var serviceName = "Test Service for Deletion";
        await CreateItemEntry(
            new Dictionary<string, string>
            {
                { "service-name", serviceName },
            },
            async () =>
            {
                // Add the attachments section via the + menu
                await AddFieldSectionAsync("Attachments");

                // Wait for the file input to appear
                await Page.WaitForSelectorAsync("input[type='file']");

                // Upload file.
                var fileInput = Page.Locator("input[type='file']");
                var fileContent = await ResourceReaderUtility.ReadEmbeddedResourceBytesAsync("AliasVault.E2ETests.TestData.TestAttachment.txt");

                // Create a temporary file with the content and original file name
                var originalFileName = "TestAttachment.txt";
                var tempFilePath = Path.Combine(Path.GetTempPath(), originalFileName);
                await File.WriteAllBytesAsync(tempFilePath, fileContent);

                // Set the file input using the temporary file
                await fileInput.SetInputFilesAsync(tempFilePath);

                // Delete the temporary file
                File.Delete(tempFilePath);
            });

        // Check that the attachment name appears on the alias page.
        var pageContent = await Page.TextContentAsync("body");
        Assert.That(pageContent, Does.Contain("TestAttachment.txt"), "Uploaded attachment name does not appear on alias page.");

        // Click the edit button
        await Page.ClickAsync("text=Edit");
        await WaitForUrlAsync("items/**/edit", "Edit the existing item");

        // Find and click the delete button for the attachment
        var deleteButton = Page.Locator("button:has-text('Delete')").First;
        await deleteButton.ClickAsync();

        // Check that the attachment name no longer appears on the edit page
        pageContent = await Page.TextContentAsync("body");
        Assert.That(pageContent, Does.Not.Contain("TestAttachment.txt"), "Deleted attachment name still appears on edit page.");

        // Save the credential
        var saveButton = Page.Locator("text=Save Item").First;
        await saveButton.ClickAsync();
        await WaitForUrlAsync("items/**", "Item updated successfully");

        // Check that the attachment name does not appear on the view page
        pageContent = await Page.TextContentAsync("body");
        Assert.That(pageContent, Does.Not.Contain("TestAttachment.txt"), "Deleted attachment name appears on view page after saving.");
    }

    /// <summary>
    /// Test that uploading multiple attachments one by one works correctly.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    [Order(4)]
    public async Task UploadMultipleAttachmentsOneByOne()
    {
        // Create a new alias with service name = "Test Service Multiple Attachments".
        var serviceName = "Test Service Multiple Attachments";
        var attachmentNames = new[] { "Attachment1.txt", "Attachment2.txt", "Attachment3.txt" };

        await CreateItemEntry(
            new Dictionary<string, string>
            {
                { "service-name", serviceName },
            },
            async () =>
            {
                // Add the attachments section via the + menu
                await AddFieldSectionAsync("Attachments");

                // Wait for the file input to appear
                await Page.WaitForSelectorAsync("input[type='file']");

                var fileInput = Page.Locator("input[type='file']");
                var fileContent = await ResourceReaderUtility.ReadEmbeddedResourceBytesAsync("AliasVault.E2ETests.TestData.TestAttachment.txt");

                foreach (var attachmentName in attachmentNames)
                {
                    var tempFilePath = Path.Combine(Path.GetTempPath(), attachmentName);
                    await File.WriteAllBytesAsync(tempFilePath, fileContent);

                    // Set the file input for each file individually
                    await fileInput.SetInputFilesAsync(tempFilePath);

                    // Wait for the file to be uploaded and the UI to update
                    await Page.WaitForSelectorAsync($"text={attachmentName}");

                    // Delete the temporary file
                    File.Delete(tempFilePath);
                }
            });

        // Check that all attachment names appear on the alias page.
        var pageContent = await Page.TextContentAsync("body");
        foreach (var attachmentName in attachmentNames)
        {
            Assert.That(pageContent, Does.Contain(attachmentName), $"Uploaded attachment name '{attachmentName}' does not appear on alias page.");
        }

        // Verify that we can download each attachment
        foreach (var attachmentName in attachmentNames)
        {
            var downloadPromise = Page.WaitForDownloadAsync();
            await Page.ClickAsync($"text={attachmentName}");
            var download = await downloadPromise;

            var downloadedFilePath = await download.PathAsync();
            var downloadedContent = await File.ReadAllBytesAsync(downloadedFilePath);

            var originalContent = await ResourceReaderUtility.ReadEmbeddedResourceBytesAsync("AliasVault.E2ETests.TestData.TestAttachment.txt");
            Assert.That(downloadedContent, Is.EqualTo(originalContent), $"Downloaded file content for '{attachmentName}' does not match the original file content.");

            File.Delete(downloadedFilePath);
        }
    }

    /// <summary>
    /// Test that adding multiple attachments to an existing credential works correctly.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    [Order(5)]
    public async Task AddMultipleAttachmentsToExistingCredential()
    {
        // Create a new empty alias with service name = "Test Service Add Multiple Attachments".
        var serviceName = "Test Service Add Multiple Attachments";
        await CreateItemEntry(
            new Dictionary<string, string>
            {
                { "service-name", serviceName },
            });

        // Edit the credential
        await Page.ClickAsync("text=Edit");
        await WaitForUrlAsync("items/**/edit", "Edit the existing item");

        // Add the attachments section via the + menu
        await AddFieldSectionAsync("Attachments");

        // Wait for the file input to appear
        await Page.WaitForSelectorAsync("input[type='file']");

        var attachmentNames = new[] { "Attachment1.txt", "Attachment2.txt", "Attachment3.txt" };
        var fileInput = Page.Locator("input[type='file']");
        var fileContent = await ResourceReaderUtility.ReadEmbeddedResourceBytesAsync("AliasVault.E2ETests.TestData.TestAttachment.txt");

        foreach (var attachmentName in attachmentNames)
        {
            var tempFilePath = Path.Combine(Path.GetTempPath(), attachmentName);
            await File.WriteAllBytesAsync(tempFilePath, fileContent);

            // Set the file input for each file individually
            await fileInput.SetInputFilesAsync(tempFilePath);

            // Wait for the file to be uploaded and the UI to update
            await Page.WaitForSelectorAsync($"text={attachmentName}");

            // Delete the temporary file
            File.Delete(tempFilePath);
        }

        // Save the updated credential
        var saveButton = Page.Locator("text=Save Item").First;
        await saveButton.ClickAsync();
        await WaitForUrlAsync("items/**", "Item updated successfully");

        // Check that all attachment names appear on the alias page.
        var pageContent = await Page.TextContentAsync("body");
        foreach (var attachmentName in attachmentNames)
        {
            Assert.That(pageContent, Does.Contain(attachmentName), $"Uploaded attachment name '{attachmentName}' does not appear on alias page.");
        }

        // Verify that we can download each attachment
        foreach (var attachmentName in attachmentNames)
        {
            var downloadPromise = Page.WaitForDownloadAsync();
            await Page.ClickAsync($"text={attachmentName}");
            var download = await downloadPromise;

            var downloadedFilePath = await download.PathAsync();
            var downloadedContent = await File.ReadAllBytesAsync(downloadedFilePath);

            var originalContent = await ResourceReaderUtility.ReadEmbeddedResourceBytesAsync("AliasVault.E2ETests.TestData.TestAttachment.txt");
            Assert.That(downloadedContent, Is.EqualTo(originalContent), $"Downloaded file content for '{attachmentName}' does not match the original file content.");

            File.Delete(downloadedFilePath);
        }
    }

    /// <summary>
    /// Test that uploading multiple attachments simultaneously works correctly.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    [Order(6)]
    public async Task UploadMultipleAttachmentsSimultaneously()
    {
        // Create a new alias with service name = "Test Service Multiple Attachments Simultaneous".
        var serviceName = "Test Service Multiple Attachments Simultaneous";
        var attachmentNames = new[] { "Attachment1.txt", "Attachment2.txt", "Attachment3.txt" };

        await CreateItemEntry(
            new Dictionary<string, string>
            {
                { "service-name", serviceName },
            },
            async () =>
            {
                // Add the attachments section via the + menu
                await AddFieldSectionAsync("Attachments");

                // Wait for the file input to appear
                await Page.WaitForSelectorAsync("input[type='file']");

                var fileInput = Page.Locator("input[type='file']");
                var fileContent = await ResourceReaderUtility.ReadEmbeddedResourceBytesAsync("AliasVault.E2ETests.TestData.TestAttachment.txt");

                var tempFilePaths = new List<string>();

                foreach (var attachmentName in attachmentNames)
                {
                    var tempFilePath = Path.Combine(Path.GetTempPath(), attachmentName);
                    await File.WriteAllBytesAsync(tempFilePath, fileContent);
                    tempFilePaths.Add(tempFilePath);
                }

                // Set the file input using all temporary files simultaneously
                await fileInput.SetInputFilesAsync(tempFilePaths.ToArray());

                // Wait for all files to be uploaded and the UI to update
                foreach (var attachmentName in attachmentNames)
                {
                    await Page.WaitForSelectorAsync($"text={attachmentName}");
                }

                // Delete the temporary files
                foreach (var tempFilePath in tempFilePaths)
                {
                    File.Delete(tempFilePath);
                }
            });

        // Check that all attachment names appear on the alias page.
        var pageContent = await Page.TextContentAsync("body");
        foreach (var attachmentName in attachmentNames)
        {
            Assert.That(pageContent, Does.Contain(attachmentName), $"Uploaded attachment name '{attachmentName}' does not appear on alias page.");
        }

        // Verify that we can download each attachment
        foreach (var attachmentName in attachmentNames)
        {
            var downloadPromise = Page.WaitForDownloadAsync();
            await Page.ClickAsync($"text={attachmentName}");
            var download = await downloadPromise;

            var downloadedFilePath = await download.PathAsync();
            var downloadedContent = await File.ReadAllBytesAsync(downloadedFilePath);

            var originalContent = await ResourceReaderUtility.ReadEmbeddedResourceBytesAsync("AliasVault.E2ETests.TestData.TestAttachment.txt");
            Assert.That(downloadedContent, Is.EqualTo(originalContent), $"Downloaded file content for '{attachmentName}' does not match the original file content.");

            File.Delete(downloadedFilePath);
        }
    }
}
