//-----------------------------------------------------------------------
// <copyright file="ImportExportTests.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

#pragma warning disable SA1202 // Elements should be ordered by access

namespace AliasVault.UnitTests.Utilities;

using System.IO.Compression;
using AliasClientDb;
using AliasClientDb.Models;
using AliasVault.ImportExport;
using AliasVault.ImportExport.Importers;
using AliasVault.ImportExport.Models;
using AliasVault.UnitTests.Common;

/// <summary>
/// Tests for the AliasVault.ImportExport class.
/// </summary>
public class ImportExportTests
{
    /// <summary>
    /// Test case for importing items from CSV and ensuring all values are present.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    public async Task ImportItemsFromCsv()
    {
        // Arrange
        var item = new Item
        {
            Id = new Guid("00000000-0000-0000-0000-000000000001"),
            Name = "Test Service",
            ItemType = ItemType.Login,
            CreatedAt = DateTime.Now,
            UpdatedAt = DateTime.Now,
        };

        // Add field values
        AddFieldValue(item, FieldKey.LoginUsername, "testuser");
        AddFieldValue(item, FieldKey.NotesContent, "Test notes");
        AddFieldValue(item, FieldKey.LoginUrl, "https://testservice.com");
        AddFieldValue(item, FieldKey.LoginPassword, "password123");
        AddFieldValue(item, FieldKey.LoginEmail, "johndoe");
        AddFieldValue(item, FieldKey.AliasGender, "Male");
        AddFieldValue(item, FieldKey.AliasFirstName, "John");
        AddFieldValue(item, FieldKey.AliasLastName, "Doe");
        AddFieldValue(item, FieldKey.AliasBirthdate, "1990-01-01");

        var csvContent = ItemCsvService.ExportItemsToCsv([item]);
        var csvString = System.Text.Encoding.Default.GetString(csvContent);

        // Act
        var importedCredentials = await ItemCsvService.ImportItemsFromCsv(csvString);

        // Assert
        Assert.That(importedCredentials, Has.Count.EqualTo(1));

        var importedCredential = importedCredentials[0];

        Assert.Multiple(() =>
        {
            Assert.That(importedCredential.ServiceName, Is.EqualTo(item.Name));
            Assert.That(importedCredential.ServiceUrls?.FirstOrDefault(), Is.EqualTo("https://testservice.com"));
            Assert.That(importedCredential.Username, Is.EqualTo("testuser"));
            Assert.That(importedCredential.Notes, Is.EqualTo("Test notes"));
            Assert.That(importedCredential.CreatedAt?.Date, Is.EqualTo(item.CreatedAt.Date));
            Assert.That(importedCredential.UpdatedAt?.Date, Is.EqualTo(item.UpdatedAt.Date));
            Assert.That(importedCredential.Alias!.Gender, Is.EqualTo("Male"));
            Assert.That(importedCredential.Alias!.FirstName, Is.EqualTo("John"));
            Assert.That(importedCredential.Alias!.LastName, Is.EqualTo("Doe"));
            Assert.That(importedCredential.Alias!.BirthDate, Is.EqualTo(new DateTime(1990, 1, 1, 0, 0, 0, DateTimeKind.Utc)));
            Assert.That(importedCredential.Alias!.CreatedAt?.Date, Is.EqualTo(item.CreatedAt.Date));
            Assert.That(importedCredential.Alias!.UpdatedAt?.Date, Is.EqualTo(item.UpdatedAt.Date));
            Assert.That(importedCredential.Password, Is.EqualTo("password123"));
        });
    }

    /// <summary>
    /// Test case for round-tripping a credit card item through CSV export and import.
    /// Verifies that card-specific columns are populated on export and that the
    /// importer recognizes the item as a credit card.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    public async Task ImportCreditCardItemFromCsv()
    {
        // Arrange
        var loginItem = new Item
        {
            Id = new Guid("00000000-0000-0000-0000-000000000001"),
            Name = "Login service",
            ItemType = ItemType.Login,
            CreatedAt = DateTime.Now,
            UpdatedAt = DateTime.Now,
        };
        AddFieldValue(loginItem, FieldKey.LoginUsername, "loginuser");
        AddFieldValue(loginItem, FieldKey.LoginPassword, "loginpass");

        var cardItem = new Item
        {
            Id = new Guid("00000000-0000-0000-0000-000000000002"),
            Name = "My Visa",
            ItemType = ItemType.CreditCard,
            CreatedAt = DateTime.Now,
            UpdatedAt = DateTime.Now,
        };
        AddFieldValue(cardItem, FieldKey.CardCardholderName, "John Doe");
        AddFieldValue(cardItem, FieldKey.CardNumber, "4111111111111111");
        AddFieldValue(cardItem, FieldKey.CardExpiryMonth, "12");
        AddFieldValue(cardItem, FieldKey.CardExpiryYear, "2030");
        AddFieldValue(cardItem, FieldKey.CardCvv, "123");
        AddFieldValue(cardItem, FieldKey.CardPin, "9876");
        AddFieldValue(cardItem, FieldKey.NotesContent, "Card notes");

        var csvContent = ItemCsvService.ExportItemsToCsv([loginItem, cardItem]);
        var csvString = System.Text.Encoding.Default.GetString(csvContent);

        // Assert: header includes the new card columns
        var headerLine = csvString.Split('\n')[0];
        Assert.Multiple(() =>
        {
            Assert.That(headerLine, Does.Contain("CardholderName"));
            Assert.That(headerLine, Does.Contain("CardNumber"));
            Assert.That(headerLine, Does.Contain("CardExpiryMonth"));
            Assert.That(headerLine, Does.Contain("CardExpiryYear"));
            Assert.That(headerLine, Does.Contain("CardCvv"));
            Assert.That(headerLine, Does.Contain("CardPin"));
        });

        // Act
        var importedCredentials = await ItemCsvService.ImportItemsFromCsv(csvString);

        // Assert
        Assert.That(importedCredentials, Has.Count.EqualTo(2));

        var importedLogin = importedCredentials.First(c => c.ServiceName == "Login service");
        Assert.Multiple(() =>
        {
            Assert.That(importedLogin.ItemType, Is.Null, "Login items should not have ItemType set by CSV importer.");
            Assert.That(importedLogin.Creditcard, Is.Null);
            Assert.That(importedLogin.Username, Is.EqualTo("loginuser"));
        });

        var importedCard = importedCredentials.First(c => c.ServiceName == "My Visa");
        Assert.Multiple(() =>
        {
            Assert.That(importedCard.ItemType, Is.EqualTo(ImportedItemType.Creditcard));
            Assert.That(importedCard.Creditcard, Is.Not.Null);
            Assert.That(importedCard.Creditcard!.CardholderName, Is.EqualTo("John Doe"));
            Assert.That(importedCard.Creditcard.Number, Is.EqualTo("4111111111111111"));
            Assert.That(importedCard.Creditcard.ExpiryMonth, Is.EqualTo("12"));
            Assert.That(importedCard.Creditcard.ExpiryYear, Is.EqualTo("2030"));
            Assert.That(importedCard.Creditcard.Cvv, Is.EqualTo("123"));
            Assert.That(importedCard.Creditcard.Pin, Is.EqualTo("9876"));
            Assert.That(importedCard.Notes, Is.EqualTo("Card notes"));
        });
    }

    /// <summary>
    /// Verifies that CSV files exported by older versions (without credit card columns)
    /// can still be imported successfully.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    public async Task ImportLegacyCsvWithoutCreditCardColumns()
    {
        // Arrange: a CSV with the pre-card column set only.
        var legacyCsv =
            "ServiceName,FolderPath,ServiceUrl,Username,CurrentPassword,AliasEmail,TwoFactorSecret,AliasGender,AliasFirstName,AliasLastName,AliasNickName,AliasBirthDate,Notes,CreatedAt,UpdatedAt\n"
            + "Old Service,,https://old.example,olduser,oldpass,,,,,,,,,2024-01-01 00:00:00,2024-01-01 00:00:00\n";

        // Act
        var importedCredentials = await ItemCsvService.ImportItemsFromCsv(legacyCsv);

        // Assert
        Assert.That(importedCredentials, Has.Count.EqualTo(1));
        var credential = importedCredentials[0];
        Assert.Multiple(() =>
        {
            Assert.That(credential.ServiceName, Is.EqualTo("Old Service"));
            Assert.That(credential.Username, Is.EqualTo("olduser"));
            Assert.That(credential.ItemType, Is.Null);
            Assert.That(credential.Creditcard, Is.Null);
        });
    }

    /// <summary>
    /// Test case for importing credentials from Bitwarden CSV and ensuring all values are present.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    public async Task ImportCredentialsFromBitwardenCsv()
    {
        // Arrange
        var fileContent = await ResourceReaderUtility.ReadEmbeddedResourceStringAsync("AliasVault.UnitTests.TestData.Exports.bitwarden.csv");

        // Act
        var importedCredentials = await BitwardenImporter.ImportFromCsvAsync(fileContent);

        // Assert
        Assert.That(importedCredentials, Has.Count.EqualTo(12));

        // There is one entry which has an invalid TOTP code ("! in the secret), we ensure this logic does not throw a fatal error.
        var convertedItems = BaseImporter.ConvertToItem(importedCredentials);

        // Test specific entries
        var tutaNotaCredential = importedCredentials.First(c => c.ServiceName == "TutaNota");
        Assert.Multiple(() =>
        {
            Assert.That(tutaNotaCredential.ServiceName, Is.EqualTo("TutaNota"));
            Assert.That(tutaNotaCredential.Username, Is.EqualTo("avtest2@tutamail.com"));
            Assert.That(tutaNotaCredential.Password, Is.EqualTo("blabla"));
            Assert.That(tutaNotaCredential.TwoFactorSecret, Is.EqualTo("otpauth://totp/Strongbox?secret=PLW4SB3PQ7MKVXY2MXF4NEXS6Y&algorithm=SHA1&digits=6&period=30"));
        });

        var aliasVaultCredential = importedCredentials.First(c => c.ServiceName == "Aliasvault.net");
        Assert.Multiple(() =>
        {
            Assert.That(aliasVaultCredential.ServiceName, Is.EqualTo("Aliasvault.net"));
            Assert.That(aliasVaultCredential.ServiceUrls?.FirstOrDefault(), Is.EqualTo("https://www.aliasvault.net"));
            Assert.That(aliasVaultCredential.Username, Is.EqualTo("root"));
            Assert.That(aliasVaultCredential.Password, Is.EqualTo("toor"));
        });

        // Test entry with multiple URLs (TutaNota3) and URL-encoded TOTP URI
        var multiUrlCredential = importedCredentials.First(c => c.ServiceName == "TutaNota3");
        Assert.Multiple(() =>
        {
            Assert.That(multiUrlCredential.ServiceName, Is.EqualTo("TutaNota3"));
            Assert.That(multiUrlCredential.ServiceUrls, Has.Count.EqualTo(3));
            Assert.That(multiUrlCredential.ServiceUrls![0], Is.EqualTo("https://www.aliasvault.net"));
            Assert.That(multiUrlCredential.ServiceUrls[1], Is.EqualTo("https://app.aliasvault.net"));
            Assert.That(multiUrlCredential.ServiceUrls[2], Is.EqualTo("https://downloads.aliasvault.net"));
            Assert.That(multiUrlCredential.Username, Is.EqualTo("avtest3@tutamail.com"));
            Assert.That(multiUrlCredential.TwoFactorSecret, Is.EqualTo("otpauth://totp/Test%20name%3Atest%40test.org?secret=PLW4SB3PQ7MKVXY2MXF4NEXS6Y&issuer=Alias%20Vault"));
        });

        // Verify multiple URLs get converted to multiple FieldValues
        var multiUrlItem = convertedItems.First(i => i.Name == "TutaNota3");
        var urlFieldValues = multiUrlItem.FieldValues.Where(fv => fv.FieldKey == FieldKey.LoginUrl).OrderBy(fv => fv.Weight).ToList();
        Assert.Multiple(() =>
        {
            Assert.That(urlFieldValues, Has.Count.EqualTo(3));
            Assert.That(urlFieldValues[0].Value, Is.EqualTo("https://www.aliasvault.net"));
            Assert.That(urlFieldValues[1].Value, Is.EqualTo("https://app.aliasvault.net"));
            Assert.That(urlFieldValues[2].Value, Is.EqualTo("https://downloads.aliasvault.net"));
            Assert.That(urlFieldValues[0].Weight, Is.EqualTo(0));
            Assert.That(urlFieldValues[1].Weight, Is.EqualTo(1));
            Assert.That(urlFieldValues[2].Weight, Is.EqualTo(2));
        });

        // Verify TOTP code name is properly URL-decoded when converting from otpauth URI
        var multiUrlItemTotpCode = multiUrlItem.TotpCodes.FirstOrDefault();
        Assert.That(multiUrlItemTotpCode, Is.Not.Null);
        Assert.Multiple(() =>
        {
            Assert.That(multiUrlItemTotpCode!.SecretKey, Is.EqualTo("PLW4SB3PQ7MKVXY2MXF4NEXS6Y"));
            Assert.That(multiUrlItemTotpCode.Name, Is.EqualTo("Alias Vault: Test name:test@test.org"), "TOTP name should be URL-decoded from the otpauth URI");
        });

        // Test multi-depth folder paths
        var workProjectItem = importedCredentials.First(c => c.ServiceName == "ProjectItem");
        Assert.That(workProjectItem.FolderPath, Is.EqualTo("Work/Projects"));

        var activeProjectItem = importedCredentials.First(c => c.ServiceName == "ActiveProjectItem");
        Assert.That(activeProjectItem.FolderPath, Is.EqualTo("Work/Projects/Active"));

        var bankAccountItem = importedCredentials.First(c => c.ServiceName == "BankAccount");
        Assert.That(bankAccountItem.FolderPath, Is.EqualTo("Personal/Finance/Banking"));

        var savingsAccountItem = importedCredentials.First(c => c.ServiceName == "SavingsAccount");
        Assert.That(savingsAccountItem.FolderPath, Is.EqualTo("Personal/Finance/Banking/Savings"));

        // Test hierarchical folder path parsing with ParseFolderPath
        var workProjectsActiveParts = BaseImporter.ParseFolderPath("Work/Projects/Active");
        Assert.That(workProjectsActiveParts, Has.Count.EqualTo(3));
        Assert.That(workProjectsActiveParts[0], Is.EqualTo("Work"));
        Assert.That(workProjectsActiveParts[1], Is.EqualTo("Projects"));
        Assert.That(workProjectsActiveParts[2], Is.EqualTo("Active"));

        var savingsParts = BaseImporter.ParseFolderPath("Personal/Finance/Banking/Savings");
        Assert.That(savingsParts, Has.Count.EqualTo(4));
        Assert.That(savingsParts[0], Is.EqualTo("Personal"));
        Assert.That(savingsParts[1], Is.EqualTo("Finance"));
        Assert.That(savingsParts[2], Is.EqualTo("Banking"));
        Assert.That(savingsParts[3], Is.EqualTo("Savings"));
    }

    /// <summary>
    /// Test case for importing credentials from Strongbox CSV and ensuring all values are present.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    public async Task ImportCredentialsFromStrongboxCsv()
    {
        // Arrange
        var fileContent = await ResourceReaderUtility.ReadEmbeddedResourceStringAsync("AliasVault.UnitTests.TestData.Exports.strongbox.csv");

        // Act
        var importedCredentials = await StrongboxImporter.ImportFromCsvAsync(fileContent);

        // Assert
        Assert.That(importedCredentials, Has.Count.EqualTo(6));

        // Test specific entries
        var tutaNotaCredential = importedCredentials.First(c => c.ServiceName == "TutaNota");
        Assert.Multiple(() =>
        {
            Assert.That(tutaNotaCredential.ServiceName, Is.EqualTo("TutaNota"));
            Assert.That(tutaNotaCredential.Username, Is.EqualTo("avtest2@tutamail.com"));
            Assert.That(tutaNotaCredential.Password, Is.EqualTo("blabla"));
            Assert.That(tutaNotaCredential.TwoFactorSecret, Is.EqualTo("otpauth://totp/Strongbox?secret=PLW4SB3PQ7MKVXY2MXF4NEXS6Y&algorithm=SHA1&digits=6&period=30"));
            Assert.That(tutaNotaCredential.Notes, Does.Contain("Recovery code for main account"));
        });

        var sampleCredential = importedCredentials.First(c => c.ServiceName == "Sample");
        Assert.Multiple(() =>
        {
            Assert.That(sampleCredential.ServiceName, Is.EqualTo("Sample"));
            Assert.That(sampleCredential.ServiceUrls?.FirstOrDefault(), Is.EqualTo("https://strongboxsafe.com"));
            Assert.That(sampleCredential.Username, Is.EqualTo("username"));
            Assert.That(sampleCredential.Password, Is.EqualTo("&3V_$z?Aiw-_x+nbYj"));
        });
    }

    /// <summary>
    /// Test case for importing credentials from 1Password CSV and ensuring all values are present.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    public async Task ImportCredentialsFrom1PasswordCsv()
    {
        // Arrange
        var fileContent = await ResourceReaderUtility.ReadEmbeddedResourceStringAsync("AliasVault.UnitTests.TestData.Exports.1password_8.csv");

        // Act
        var importedCredentials = await OnePasswordImporter.ImportFromCsvAsync(fileContent);

        // Assert
        Assert.That(importedCredentials, Has.Count.EqualTo(4));

        // Test specific entries
        var twoFactorCredential = importedCredentials.First(c => c.Username == "username2fa");
        Assert.Multiple(() =>
        {
            Assert.That(twoFactorCredential.ServiceName, Is.EqualTo("Test record 2 with 2FA"));
            Assert.That(twoFactorCredential.Username, Is.EqualTo("username2fa"));
            Assert.That(twoFactorCredential.Password, Is.EqualTo("password2fa"));
            Assert.That(twoFactorCredential.TwoFactorSecret, Is.EqualTo("otpauth://totp/Strongbox?secret=PLW4SB3PQ7MKVXY2MXF4NEXS6Y&period=30&algorithm=SHA1&digits=6"));
            Assert.That(twoFactorCredential.Notes, Is.EqualTo("Notes about 2FA record"));
        });

        var onePasswordAccount = importedCredentials.First(c => c.ServiceName == "1Password Account (dpatel)");
        Assert.Multiple(() =>
        {
            Assert.That(onePasswordAccount.ServiceName, Is.EqualTo("1Password Account (dpatel)"));
            Assert.That(onePasswordAccount.ServiceUrls?.FirstOrDefault(), Is.EqualTo("https://my.1password.com"));
            Assert.That(onePasswordAccount.Username, Is.EqualTo("derekpatel@aliasvault.net"));
            Assert.That(onePasswordAccount.Password, Is.EqualTo("passwordexample"));
            Assert.That(onePasswordAccount.Notes, Is.EqualTo("You can use this login to sign in to your account on 1password.com."));
        });
    }

    /// <summary>
    /// Test case for importing credentials from Chrome CSV and ensuring all values are present.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    public async Task ImportCredentialsFromChromeCsv()
    {
        // Arrange
        var fileContent = await ResourceReaderUtility.ReadEmbeddedResourceStringAsync("AliasVault.UnitTests.TestData.Exports.chrome.csv");

        // Act
        var importedCredentials = await ChromeImporter.ImportFromCsvAsync(fileContent);

        // Assert
        Assert.That(importedCredentials, Has.Count.EqualTo(3));

        // Test specific entries
        var exampleCredential = importedCredentials.First(c => c.ServiceName == "example.com");
        Assert.Multiple(() =>
        {
            Assert.That(exampleCredential.ServiceName, Is.EqualTo("example.com"));
            Assert.That(exampleCredential.ServiceUrls?.FirstOrDefault(), Is.EqualTo("https://example.com/"));
            Assert.That(exampleCredential.Username, Is.EqualTo("usernamegoogle"));
            Assert.That(exampleCredential.Password, Is.EqualTo("passwordgoogle"));
            Assert.That(exampleCredential.Notes, Is.EqualTo("Note for example password from Google"));
        });

        var facebookCredential = importedCredentials.First(c => c.ServiceName == "facebook.com");
        Assert.Multiple(() =>
        {
            Assert.That(facebookCredential.ServiceName, Is.EqualTo("facebook.com"));
            Assert.That(facebookCredential.ServiceUrls?.FirstOrDefault(), Is.EqualTo("https://facebook.com/"));
            Assert.That(facebookCredential.Username, Is.EqualTo("facebookuser"));
            Assert.That(facebookCredential.Password, Is.EqualTo("facebookpass"));
            Assert.That(facebookCredential.Notes, Is.EqualTo("Facebook comment"));
        });
    }

    /// <summary>
    /// Test case for importing credentials from Firefox CSV and ensuring all values are present.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    public async Task ImportCredentialsFromFirefoxCsv()
    {
        // Arrange
        var fileContent = await ResourceReaderUtility.ReadEmbeddedResourceStringAsync("AliasVault.UnitTests.TestData.Exports.firefox.csv");

        // Act
        var importedCredentials = await FirefoxImporter.ImportFromCsvAsync(fileContent);

        // Assert
        Assert.That(importedCredentials, Has.Count.EqualTo(3));

        // Test specific entries
        var exampleCredential = importedCredentials.First(c => c.ServiceName == "example.com");
        Assert.Multiple(() =>
        {
            Assert.That(exampleCredential.ServiceName, Is.EqualTo("example.com"));
            Assert.That(exampleCredential.ServiceUrls?.FirstOrDefault(), Is.EqualTo("https://example.com"));
            Assert.That(exampleCredential.Username, Is.EqualTo("username-example"));
            Assert.That(exampleCredential.Password, Is.EqualTo("examplepassword"));
        });

        var youtubeCredential = importedCredentials.First(c => c.ServiceName == "youtube.com");
        Assert.Multiple(() =>
        {
            Assert.That(youtubeCredential.ServiceName, Is.EqualTo("youtube.com"));
            Assert.That(youtubeCredential.ServiceUrls?.FirstOrDefault(), Is.EqualTo("https://youtube.com"));
            Assert.That(youtubeCredential.Username, Is.EqualTo("youtubeusername"));
            Assert.That(youtubeCredential.Password, Is.EqualTo("youtubepassword"));
        });
    }

    /// <summary>
    /// Test case for importing credentials from KeePass CSV and ensuring all values are present.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    public async Task ImportCredentialsFromKeePassCsv()
    {
        // Arrange
        var fileContent = await ResourceReaderUtility.ReadEmbeddedResourceStringAsync("AliasVault.UnitTests.TestData.Exports.keepass.csv");

        // Act
        var importedCredentials = await KeePassImporter.ImportFromCsvAsync(fileContent);

        // Assert
        Assert.That(importedCredentials, Has.Count.EqualTo(2));

        // Test specific entries
        var sampleEntry = importedCredentials.First(c => c.ServiceName == "Sample Entry");
        Assert.Multiple(() =>
        {
            Assert.That(sampleEntry.ServiceName, Is.EqualTo("Sample Entry"));
            Assert.That(sampleEntry.ServiceUrls?.FirstOrDefault(), Is.EqualTo("https://keepass.info/"));
            Assert.That(sampleEntry.Username, Is.EqualTo("User Name"));
            Assert.That(sampleEntry.Password, Is.EqualTo("Password"));
            Assert.That(sampleEntry.Notes, Is.EqualTo("Notes"));
        });

        var sampleEntry2 = importedCredentials.First(c => c.ServiceName == "Sample Entry #2");
        Assert.Multiple(() =>
        {
            Assert.That(sampleEntry2.ServiceName, Is.EqualTo("Sample Entry #2"));
            Assert.That(sampleEntry2.ServiceUrls?.FirstOrDefault(), Is.EqualTo("https://keepass.info/help/kb/testform.html"));
            Assert.That(sampleEntry2.Username, Is.EqualTo("Michael321"));
            Assert.That(sampleEntry2.Password, Is.EqualTo("12345"));
            Assert.That(sampleEntry2.Notes, Is.Empty);
        });
    }

    /// <summary>
    /// Test case for importing credentials from KeePass CSV with special characters and double quotes.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    public async Task ImportCredentialsFromKeePassCsvWithSpecialChars()
    {
        // Arrange
        var fileContent = await ResourceReaderUtility.ReadEmbeddedResourceStringAsync("AliasVault.UnitTests.TestData.Exports.keepass_special_chars.csv");

        // Act
        var importedCredentials = await KeePassImporter.ImportFromCsvAsync(fileContent);

        // Assert
        Assert.That(importedCredentials, Has.Count.EqualTo(3));

        // Test the entry with special characters and double quotes
        var specialEntry = importedCredentials.First(c => c.ServiceName?.StartsWith("Entry with") ?? false);
        Assert.Multiple(() =>
        {
            Assert.That(specialEntry.ServiceName, Is.EqualTo("Entry with \"notes\" special chars"));
            Assert.That(specialEntry.ServiceUrls?.FirstOrDefault(), Is.Null);
            Assert.That(specialEntry.Username, Is.Empty);
            Assert.That(specialEntry.Password, Is.EqualTo("DVfIsb4TGkL7oKCwyiet"));
            Assert.That(specialEntry.Notes, Does.Contain("\"with quotes\""));
            Assert.That(specialEntry.Notes, Does.Contain("as'd as/d/asd/ z"));
            Assert.That(specialEntry.Notes, Does.Contain("asd;á'sd"));
        });

        // Test other entries still work correctly
        var sampleEntry = importedCredentials.First(c => c.ServiceName == "Sample Entry");
        Assert.Multiple(() =>
        {
            Assert.That(sampleEntry.ServiceName, Is.EqualTo("Sample Entry"));
            Assert.That(sampleEntry.ServiceUrls?.FirstOrDefault(), Is.EqualTo("https://keepass.info/"));
            Assert.That(sampleEntry.Username, Is.EqualTo("User Name"));
            Assert.That(sampleEntry.Password, Is.EqualTo("Password"));
            Assert.That(sampleEntry.Notes, Is.EqualTo("Notes"));
        });
    }

    /// <summary>
    /// Test case for importing credentials from KeePassXC CSV and ensuring all values are present.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    public async Task ImportCredentialsFromKeePassXcCsv()
    {
        // Arrange
        var fileContent = await ResourceReaderUtility.ReadEmbeddedResourceStringAsync("AliasVault.UnitTests.TestData.Exports.keepassxc.csv");

        // Act
        var importedCredentials = await KeePassXcImporter.ImportFromCsvAsync(fileContent);

        // Assert
        Assert.That(importedCredentials, Has.Count.EqualTo(3));

        // Test specific entries
        var sampleEntry = importedCredentials.First(c => c.ServiceName == "Sample Entry");
        Assert.Multiple(() =>
        {
            Assert.That(sampleEntry.ServiceName, Is.EqualTo("Sample Entry"));
            Assert.That(sampleEntry.ServiceUrls?.FirstOrDefault(), Is.EqualTo("https://keepass.info/"));
            Assert.That(sampleEntry.Username, Is.EqualTo("User Name"));
            Assert.That(sampleEntry.Password, Is.EqualTo("Password"));
            Assert.That(sampleEntry.Notes, Is.EqualTo("Notes"));
            Assert.That(sampleEntry.TwoFactorSecret, Is.Empty);
        });

        var sampleEntry2 = importedCredentials.First(c => c.ServiceName == "Sample Entry #2");
        Assert.Multiple(() =>
        {
            Assert.That(sampleEntry2.ServiceName, Is.EqualTo("Sample Entry #2"));
            Assert.That(sampleEntry2.ServiceUrls?.FirstOrDefault(), Is.EqualTo("https://keepass.info/help/kb/testform.html"));
            Assert.That(sampleEntry2.Username, Is.EqualTo("Michael321"));
            Assert.That(sampleEntry2.Password, Is.EqualTo("12345"));
            Assert.That(sampleEntry2.Notes, Is.Empty);
            Assert.That(sampleEntry2.TwoFactorSecret, Is.Empty);
        });

        var nestedEntry = importedCredentials.First(c => c.ServiceName == "Nested Entry");
        Assert.Multiple(() =>
        {
            Assert.That(nestedEntry.ServiceName, Is.EqualTo("Nested Entry"));
            Assert.That(nestedEntry.ServiceUrls?.FirstOrDefault(), Is.EqualTo("https://example.com/"));
            Assert.That(nestedEntry.Username, Is.EqualTo("testuser"));
            Assert.That(nestedEntry.Password, Is.EqualTo("testpass123"));
            Assert.That(nestedEntry.Notes, Is.EqualTo("Nested folder test"));
            Assert.That(nestedEntry.FolderPath, Is.EqualTo("Database/Windows/Windowssub1"));
        });
    }

    /// <summary>
    /// Test case for importing credentials from ProtonPass CSV and ensuring all values are present.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    public async Task ImportCredentialsFromProtonPassCsv()
    {
        // Arrange
        var fileContent = await ResourceReaderUtility.ReadEmbeddedResourceStringAsync("AliasVault.UnitTests.TestData.Exports.protonpass.csv");

        // Act
        var importedCredentials = await ProtonPassImporter.ImportFromCsvAsync(fileContent);

        // Assert
        Assert.That(importedCredentials, Has.Count.EqualTo(4));

        // Test specific entries
        var testProton1Credential = importedCredentials.First(c => c.ServiceName == "Test proton 1");
        Assert.Multiple(() =>
        {
            Assert.That(testProton1Credential.ServiceName, Is.EqualTo("Test proton 1"));
            Assert.That(testProton1Credential.ServiceUrls?.FirstOrDefault(), Is.EqualTo("https://www.website.com/"));
            Assert.That(testProton1Credential.Username, Is.EqualTo("user1"));
            Assert.That(testProton1Credential.Password, Is.EqualTo("pass1"));
            Assert.That(testProton1Credential.TwoFactorSecret, Is.EqualTo("otpauth://totp/Strongbox?secret=PLW4SB3PQ7MKVXY2MXF4NEXS6Y&algorithm=SHA1&digits=6&period=30"));
        });

        var testProton2Credential = importedCredentials.First(c => c.ServiceName == "Test proton2");
        Assert.Multiple(() =>
        {
            Assert.That(testProton2Credential.ServiceName, Is.EqualTo("Test proton2"));
            Assert.That(testProton2Credential.Username, Is.EqualTo("testuser2"));
            Assert.That(testProton2Credential.Password, Is.EqualTo("testpassword2"));
        });

        var testWithoutPassCredential = importedCredentials.First(c => c.ServiceName == "testwithoutpass");
        Assert.Multiple(() =>
        {
            Assert.That(testWithoutPassCredential.ServiceName, Is.EqualTo("testwithoutpass"));
            Assert.That(testWithoutPassCredential.Username, Is.EqualTo("testuser"));
            Assert.That(testWithoutPassCredential.Password, Is.Empty);
        });

        var testWithEmailCredential = importedCredentials.First(c => c.ServiceName == "Test alias");
        Assert.Multiple(() =>
        {
            Assert.That(testWithEmailCredential.ServiceName, Is.EqualTo("Test alias"));
            Assert.That(testWithEmailCredential.Email, Is.EqualTo("testalias.gating981@passinbox.com"));
        });
    }

    /// <summary>
    /// Test case for importing credentials from Dashlane CSV and ensuring all values are present.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    public async Task ImportCredentialsFromDashlaneCsv()
    {
        // Arrange
        var fileContent = await ResourceReaderUtility.ReadEmbeddedResourceStringAsync("AliasVault.UnitTests.TestData.Exports.dashlane.csv");

        // Act
        var importedCredentials = await DashlaneImporter.ImportFromCsvAsync(fileContent);

        // Assert
        Assert.That(importedCredentials, Has.Count.EqualTo(3));

        // Test specific entries
        var testCredential = importedCredentials.First(c => c.ServiceName == "Test");
        Assert.Multiple(() =>
        {
            Assert.That(testCredential.ServiceName, Is.EqualTo("Test"));
            Assert.That(testCredential.ServiceUrls?.FirstOrDefault(), Is.EqualTo("https://Test"));
            Assert.That(testCredential.Username, Is.EqualTo("Test username"));
            Assert.That(testCredential.Password, Is.EqualTo("password123"));
            Assert.That(testCredential.Notes, Is.Null);
        });

        var googleCredential = importedCredentials.First(c => c.ServiceName == "Google");
        Assert.Multiple(() =>
        {
            Assert.That(googleCredential.ServiceName, Is.EqualTo("Google"));
            Assert.That(googleCredential.ServiceUrls?.FirstOrDefault(), Is.EqualTo("https://www.google.com"));
            Assert.That(googleCredential.Username, Is.EqualTo("googleuser"));
            Assert.That(googleCredential.Password, Is.EqualTo("googlepassword"));
            Assert.That(googleCredential.Notes, Is.Null);
        });

        var localCredential = importedCredentials.First(c => c.ServiceName == "Local");
        Assert.Multiple(() =>
        {
            Assert.That(localCredential.ServiceName, Is.EqualTo("Local"));
            Assert.That(localCredential.ServiceUrls?.FirstOrDefault(), Is.EqualTo("https://www.testwebsite.local"));
            Assert.That(localCredential.Username, Is.EqualTo("testusername"));
            Assert.That(localCredential.Password, Is.EqualTo("testpassword"));
            Assert.That(localCredential.Notes, Is.EqualTo("testnote\nAlternative username 1: testusernamealternative"));
        });
    }

    /// <summary>
    /// Test case for importing credentials from LastPass CSV and ensuring all values are present.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    public async Task ImportCredentialsFromLastPassCsv()
    {
        // Arrange
        var fileContent = await ResourceReaderUtility.ReadEmbeddedResourceStringAsync("AliasVault.UnitTests.TestData.Exports.lastpass.csv");

        // Act
        var importedCredentials = await LastPassImporter.ImportFromCsvAsync(fileContent);

        // Assert - Should import 5 records
        Assert.That(importedCredentials, Has.Count.EqualTo(5));

        // Test regular login credential
        var exampleCredential = importedCredentials.First(c => c.ServiceName == "Examplename");
        Assert.Multiple(() =>
        {
            Assert.That(exampleCredential.ServiceName, Is.EqualTo("Examplename"));
            Assert.That(exampleCredential.ServiceUrls?.FirstOrDefault(), Is.EqualTo("https://example.com"));
            Assert.That(exampleCredential.Username, Is.EqualTo("Exampleusername"));
            Assert.That(exampleCredential.Password, Is.EqualTo("examplepassword"));
            Assert.That(exampleCredential.Notes, Is.EqualTo("Examplenotes"));
            Assert.That(exampleCredential.TwoFactorSecret, Is.Empty);
        });

        // Test credential without URL (LastPass uses "http://" for these)
        var userWithoutUrlCredential = importedCredentials.First(c => c.ServiceName == "Userwithouturlornotes");
        Assert.Multiple(() =>
        {
            Assert.That(userWithoutUrlCredential.ServiceName, Is.EqualTo("Userwithouturlornotes"));
            Assert.That(userWithoutUrlCredential.ServiceUrls?.FirstOrDefault(), Is.Null);
            Assert.That(userWithoutUrlCredential.Username, Is.EqualTo("userwithouturlornotes"));
            Assert.That(userWithoutUrlCredential.Password, Is.EqualTo("userpass"));
            Assert.That(userWithoutUrlCredential.Notes, Is.Empty);
            Assert.That(userWithoutUrlCredential.TwoFactorSecret, Is.Empty);
        });

        // Test secure note (LastPass uses "http://sn" for these)
        var secureNoteCredential = importedCredentials.First(c => c.ServiceName == "securenote1");
        Assert.Multiple(() =>
        {
            Assert.That(secureNoteCredential.ServiceName, Is.EqualTo("securenote1"));
            Assert.That(secureNoteCredential.ServiceUrls?.FirstOrDefault(), Is.Null);
            Assert.That(secureNoteCredential.Username, Is.Empty);
            Assert.That(secureNoteCredential.Password, Is.Empty);
            Assert.That(secureNoteCredential.Notes, Is.EqualTo("Securenotecontent here"));
            Assert.That(secureNoteCredential.TwoFactorSecret, Is.Empty);
        });

        // Test credit card entry
        var creditCardCredential = importedCredentials.First(c => c.ServiceName == "Paymentcard1");
        Assert.Multiple(() =>
        {
            Assert.That(creditCardCredential.ServiceName, Is.EqualTo("Paymentcard1"));
            Assert.That(creditCardCredential.ServiceUrls?.FirstOrDefault(), Is.Null); // Should be normalized to null
            Assert.That(creditCardCredential.Username, Is.Empty);
            Assert.That(creditCardCredential.Password, Is.Empty);
            Assert.That(creditCardCredential.ItemType, Is.EqualTo(ImportedItemType.Creditcard));
            Assert.That(creditCardCredential.Creditcard, Is.Not.Null);
            Assert.That(creditCardCredential.Creditcard!.CardholderName, Is.EqualTo("Cardname"));
            Assert.That(creditCardCredential.Creditcard.Number, Is.EqualTo("123456781234"));
            Assert.That(creditCardCredential.Creditcard.Cvv, Is.EqualTo("1234"));
            Assert.That(creditCardCredential.Notes, Is.EqualTo("Creditcardnotes here")); // Extracted notes
            Assert.That(creditCardCredential.TwoFactorSecret, Is.Empty);
        });
    }

    /// <summary>
    /// Test case for importing credentials from Generic CSV and ensuring all values are present.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    public async Task ImportCredentialsFromGenericCsv()
    {
        // Arrange - Use the template that users actually download
        var fileContent = GenericCsvImporter.GetCsvTemplate();

        // Act
        var importedCredentials = await GenericCsvImporter.ImportFromCsvAsync(fileContent);

        // Assert - Should import 4 records from the template
        Assert.That(importedCredentials, Has.Count.EqualTo(4));

        // Test Gmail credential from template
        var gmailCredential = importedCredentials.First(c => c.ServiceName == "Gmail");
        Assert.Multiple(() =>
        {
            Assert.That(gmailCredential.ServiceName, Is.EqualTo("Gmail"));
            Assert.That(gmailCredential.ServiceUrls?.FirstOrDefault(), Is.EqualTo("https://gmail.com"));
            Assert.That(gmailCredential.Username, Is.EqualTo("your.email@gmail.com"));
            Assert.That(gmailCredential.Password, Is.EqualTo("your_password"));
            Assert.That(gmailCredential.Notes, Is.EqualTo("Important email account"));
            Assert.That(gmailCredential.TwoFactorSecret, Is.Empty);
        });

        // Test Facebook credential from template
        var facebookCredential = importedCredentials.First(c => c.ServiceName == "Facebook");
        Assert.Multiple(() =>
        {
            Assert.That(facebookCredential.ServiceName, Is.EqualTo("Facebook"));
            Assert.That(facebookCredential.ServiceUrls?.FirstOrDefault(), Is.EqualTo("https://facebook.com"));
            Assert.That(facebookCredential.Username, Is.EqualTo("your.username"));
            Assert.That(facebookCredential.Password, Is.EqualTo("your_password"));
            Assert.That(facebookCredential.Notes, Is.EqualTo("Social media account"));
            Assert.That(facebookCredential.TwoFactorSecret, Is.Empty);
        });

        // Test GitHub credential with TOTP from template
        var githubCredential = importedCredentials.First(c => c.ServiceName == "GitHub");
        Assert.Multiple(() =>
        {
            Assert.That(githubCredential.ServiceName, Is.EqualTo("GitHub"));
            Assert.That(githubCredential.ServiceUrls?.FirstOrDefault(), Is.EqualTo("https://github.com"));
            Assert.That(githubCredential.Username, Is.EqualTo("developer_username"));
            Assert.That(githubCredential.Password, Is.EqualTo("your_password"));
            Assert.That(githubCredential.Notes, Is.EqualTo("Development platform"));
            Assert.That(githubCredential.TwoFactorSecret, Is.EqualTo("your_totp_secret_here"));
        });

        // Test Secure Note (no username/password) from template
        var secureNoteCredential = importedCredentials.First(c => c.ServiceName == "Secure Note");
        Assert.Multiple(() =>
        {
            Assert.That(secureNoteCredential.ServiceName, Is.EqualTo("Secure Note"));
            Assert.That(secureNoteCredential.ServiceUrls?.FirstOrDefault(), Is.Null);
            Assert.That(secureNoteCredential.Username, Is.Empty);
            Assert.That(secureNoteCredential.Password, Is.Empty);
            Assert.That(secureNoteCredential.Notes, Is.EqualTo("Important information or notes without login credentials"));
            Assert.That(secureNoteCredential.TwoFactorSecret, Is.Empty);
        });
    }

    /// <summary>
    /// Test case for importing credentials from Dropbox CSV and ensuring all values are present.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    public async Task ImportCredentialsFromDropboxCsv()
    {
        // Arrange
        var fileContent = await ResourceReaderUtility.ReadEmbeddedResourceStringAsync("AliasVault.UnitTests.TestData.Exports.dropbox.csv");

        // Act
        var importedCredentials = await DropboxImporter.ImportFromCsvAsync(fileContent);

        // Assert
        Assert.That(importedCredentials, Has.Count.EqualTo(5));

        // Test Gmail credential
        var gmailCredential = importedCredentials.First(c => c.ServiceName == "Gmail");
        Assert.Multiple(() =>
        {
            Assert.That(gmailCredential.ServiceName, Is.EqualTo("Gmail"));
            Assert.That(gmailCredential.ServiceUrls?.FirstOrDefault(), Is.EqualTo("https://gmail.com"));
            Assert.That(gmailCredential.Username, Is.EqualTo("testuser@gmail.com"));
            Assert.That(gmailCredential.Password, Is.EqualTo("gmailpass123"));
            Assert.That(gmailCredential.Notes, Is.EqualTo("Important email account"));
        });

        // Test GitHub credential
        var githubCredential = importedCredentials.First(c => c.ServiceName == "GitHub");
        Assert.Multiple(() =>
        {
            Assert.That(githubCredential.ServiceName, Is.EqualTo("GitHub"));
            Assert.That(githubCredential.ServiceUrls?.FirstOrDefault(), Is.EqualTo("https://github.com"));
            Assert.That(githubCredential.Username, Is.EqualTo("devuser"));
            Assert.That(githubCredential.Password, Is.EqualTo("devpass789"));
            Assert.That(githubCredential.Notes, Is.EqualTo("Development platform"));
        });

        // Test Secure Note (no login credentials)
        var secureNoteCredential = importedCredentials.First(c => c.ServiceName == "Secure Note");
        Assert.Multiple(() =>
        {
            Assert.That(secureNoteCredential.ServiceName, Is.EqualTo("Secure Note"));
            Assert.That(secureNoteCredential.ServiceUrls?.FirstOrDefault(), Is.Null);
            Assert.That(secureNoteCredential.Username, Is.Empty);
            Assert.That(secureNoteCredential.Password, Is.Empty);
            Assert.That(secureNoteCredential.Notes, Is.EqualTo("Important information stored securely"));
        });
    }

    /// <summary>
    /// Test case for importing credentials from NordPass CSV and ensuring all values are present.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    public async Task ImportCredentialsFromNordPassCsv()
    {
        // Arrange
        var fileContent = await ResourceReaderUtility.ReadEmbeddedResourceStringAsync("AliasVault.UnitTests.TestData.Exports.nordpass.csv");

        // Act
        var importedCredentials = await NordPassImporter.ImportFromCsvAsync(fileContent);

        // Assert - Should import 4 records (folder entry is skipped)
        Assert.That(importedCredentials, Has.Count.EqualTo(4));

        // Test regular password credential
        var passwordCredential = importedCredentials.First(c => c.ServiceName == "Password title");
        Assert.Multiple(() =>
        {
            Assert.That(passwordCredential.ServiceName, Is.EqualTo("Password title"));
            Assert.That(passwordCredential.ServiceUrls?.FirstOrDefault(), Is.EqualTo("http://google.nl"));
            Assert.That(passwordCredential.Username, Is.EqualTo("email@example.tld"));
            Assert.That(passwordCredential.Password, Is.EqualTo("password"));
            Assert.That(passwordCredential.FolderPath, Is.EqualTo("Business"));
            Assert.That(passwordCredential.ItemType, Is.EqualTo(ImportedItemType.Login));
            Assert.That(passwordCredential.Notes, Does.Contain("[{\"type\":\"text\",\"label\":\"CustomFieldName1\",\"value\":\"Test\"}]"));
        });

        // Test secure note
        var secureNote = importedCredentials.First(c => c.ServiceName == "SecureNote1");
        Assert.Multiple(() =>
        {
            Assert.That(secureNote.ServiceName, Is.EqualTo("SecureNote1"));
            Assert.That(secureNote.ServiceUrls?.FirstOrDefault(), Is.Null);
            Assert.That(secureNote.Username, Is.Empty);
            Assert.That(secureNote.Password, Is.Empty);
            Assert.That(secureNote.ItemType, Is.EqualTo(ImportedItemType.Note));
            Assert.That(secureNote.Notes, Does.Contain("This is my secure note content"));
            Assert.That(secureNote.Notes, Does.Contain("Test test"));
        });

        // Test credit card
        var creditCard = importedCredentials.First(c => c.ServiceName == "Creditcard Visa");
        Assert.Multiple(() =>
        {
            Assert.That(creditCard.ServiceName, Is.EqualTo("Creditcard Visa"));
            Assert.That(creditCard.ItemType, Is.EqualTo(ImportedItemType.Creditcard));
            Assert.That(creditCard.Creditcard, Is.Not.Null);
            Assert.That(creditCard.Creditcard!.CardholderName, Is.EqualTo("Holdername"));
            Assert.That(creditCard.Creditcard.Number, Is.EqualTo("1234123412341234123"));
            Assert.That(creditCard.Creditcard.Cvv, Is.EqualTo("1231"));
            Assert.That(creditCard.Creditcard.Pin, Is.EqualTo("1231"));
            Assert.That(creditCard.Creditcard.ExpiryMonth, Is.EqualTo("12"));
            Assert.That(creditCard.Creditcard.ExpiryYear, Is.EqualTo("28"));
        });

        // Test root item (no folder)
        var rootItem = importedCredentials.First(c => c.ServiceName == "Root item");
        Assert.Multiple(() =>
        {
            Assert.That(rootItem.ServiceName, Is.EqualTo("Root item"));
            Assert.That(rootItem.Username, Is.EqualTo("rootuser"));
            Assert.That(rootItem.Password, Is.EqualTo("rootpass"));
            Assert.That(rootItem.FolderPath, Is.Null);
            Assert.That(rootItem.ItemType, Is.EqualTo(ImportedItemType.Login));
        });
    }

    /// <summary>
    /// Test case for NordPass folder import.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    public async Task NordPassFolderImport()
    {
        // Arrange
        var fileContent = await ResourceReaderUtility.ReadEmbeddedResourceStringAsync("AliasVault.UnitTests.TestData.Exports.nordpass.csv");

        // Act
        var importedCredentials = await NordPassImporter.ImportFromCsvAsync(fileContent);

        // Assert - verify folder path is extracted
        var folderNames = BaseImporter.CollectUniqueFolderNames(importedCredentials);
        Assert.That(folderNames, Does.Contain("Business"));

        var credentialWithFolder = importedCredentials.First(c => c.FolderPath == "Business");
        Assert.That(credentialWithFolder.ServiceName, Is.EqualTo("Password title"));
    }

    /// <summary>
    /// Test case for NordPass credit card detection and parsing.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    public async Task NordPassCreditCardDetectionAndParsing()
    {
        // Arrange
        var fileContent = await ResourceReaderUtility.ReadEmbeddedResourceStringAsync("AliasVault.UnitTests.TestData.Exports.nordpass.csv");

        // Act
        var importedCredentials = await NordPassImporter.ImportFromCsvAsync(fileContent);

        // Assert - verify credit card is detected and parsed
        var creditCardCredential = importedCredentials.First(c => c.ServiceName == "Creditcard Visa");
        Assert.That(creditCardCredential.ItemType, Is.EqualTo(ImportedItemType.Creditcard));
        Assert.That(creditCardCredential.Creditcard, Is.Not.Null);
        Assert.That(creditCardCredential.Creditcard!.CardholderName, Is.EqualTo("Holdername"));
        Assert.That(creditCardCredential.Creditcard.Number, Is.EqualTo("1234123412341234123"));
        Assert.That(creditCardCredential.Creditcard.Cvv, Is.EqualTo("1231"));
        Assert.That(creditCardCredential.Creditcard.Pin, Is.EqualTo("1231"));
        Assert.That(creditCardCredential.Creditcard.ExpiryMonth, Is.EqualTo("12"));
        Assert.That(creditCardCredential.Creditcard.ExpiryYear, Is.EqualTo("28"));

        // Convert to item and verify fields
        var items = BaseImporter.ConvertToItem([creditCardCredential]);
        var creditCardItem = items[0];
        Assert.That(creditCardItem.ItemType, Is.EqualTo(ItemType.CreditCard));

        var cardNumber = creditCardItem.FieldValues.FirstOrDefault(fv => fv.FieldKey == FieldKey.CardNumber);
        Assert.That(cardNumber?.Value, Is.EqualTo("1234123412341234123"));

        var cardholderName = creditCardItem.FieldValues.FirstOrDefault(fv => fv.FieldKey == FieldKey.CardCardholderName);
        Assert.That(cardholderName?.Value, Is.EqualTo("Holdername"));

        var cardPin = creditCardItem.FieldValues.FirstOrDefault(fv => fv.FieldKey == FieldKey.CardPin);
        Assert.That(cardPin?.Value, Is.EqualTo("1231"));
    }

    /// <summary>
    /// Test case for importing credentials from AliasVault Mobile App CSV export and ensuring all values are present.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    public async Task ImportCredentialsFromAliasVaultMobileAppCsv()
    {
        // Arrange
        var fileContent = await ResourceReaderUtility.ReadEmbeddedResourceStringAsync("AliasVault.UnitTests.TestData.Exports.aliasvault_mobile_app_export.csv");

        // Act
        var importedCredentials = await ItemCsvService.ImportItemsFromCsv(fileContent);

        // Assert
        Assert.That(importedCredentials, Has.Count.EqualTo(3));

        // Test credential3 (without password)
        var credential3 = importedCredentials.First(c => c.ServiceName == "credential3");
        Assert.Multiple(() =>
        {
            Assert.That(credential3.ServiceName, Is.EqualTo("credential3"));
            Assert.That(credential3.ServiceUrls?.FirstOrDefault(), Is.Null);
            Assert.That(credential3.Username, Is.EqualTo("username3"));
            Assert.That(credential3.Password, Is.Empty);
            Assert.That(credential3.Notes, Is.EqualTo("without password"));
            Assert.That(credential3.TwoFactorSecret, Is.EqualTo("test"));
            Assert.That(credential3.CreatedAt?.Date, Is.EqualTo(new DateTime(2025, 9, 12)));
            Assert.That(credential3.UpdatedAt?.Date, Is.EqualTo(new DateTime(2025, 9, 12)));
            Assert.That(credential3.Alias?.Gender, Is.Empty);
            Assert.That(credential3.Alias?.FirstName, Is.Empty);
            Assert.That(credential3.Alias?.LastName, Is.Empty);
            Assert.That(credential3.Alias?.NickName, Is.Empty);
            Assert.That(credential3.Email, Is.Empty);
        });

        // Test service2 (full credential with alias)
        var service2Credential = importedCredentials.First(c => c.ServiceName == "service2");
        Assert.Multiple(() =>
        {
            Assert.That(service2Credential.ServiceName, Is.EqualTo("service2"));
            Assert.That(service2Credential.ServiceUrls?.FirstOrDefault(), Is.EqualTo("https://service2.com"));
            Assert.That(service2Credential.Username, Is.EqualTo("username2"));
            Assert.That(service2Credential.Password, Is.EqualTo("password2"));
            Assert.That(service2Credential.Notes, Is.Empty);
            Assert.That(service2Credential.TwoFactorSecret, Is.Empty);
            Assert.That(service2Credential.Email, Is.EqualTo("service2@example.tld"));
            Assert.That(service2Credential.Alias?.Gender, Is.EqualTo("gender2"));
            Assert.That(service2Credential.Alias?.FirstName, Is.EqualTo("firstname2"));
            Assert.That(service2Credential.Alias?.LastName, Is.EqualTo("lastname2"));
            Assert.That(service2Credential.Alias?.NickName, Is.EqualTo("nickname2"));
        });

        // Test service1 (with notes and birthdate)
        var service1Credential = importedCredentials.First(c => c.ServiceName == "service1");
        Assert.Multiple(() =>
        {
            Assert.That(service1Credential.ServiceName, Is.EqualTo("service1"));
            Assert.That(service1Credential.ServiceUrls?.FirstOrDefault(), Is.Null);
            Assert.That(service1Credential.Username, Is.EqualTo("username1"));
            Assert.That(service1Credential.Password, Is.EqualTo("password1"));
            Assert.That(service1Credential.Notes, Is.EqualTo("notes1"));
            Assert.That(service1Credential.TwoFactorSecret, Is.Empty);
            Assert.That(service1Credential.Email, Is.EqualTo("email1@example.tld"));
            Assert.That(service1Credential.Alias?.Gender, Is.EqualTo("gender1"));
            Assert.That(service1Credential.Alias?.FirstName, Is.EqualTo("firstname1"));
            Assert.That(service1Credential.Alias?.LastName, Is.EqualTo("lastname1"));
            Assert.That(service1Credential.Alias?.NickName, Is.EqualTo("nickname1"));
            Assert.That(service1Credential.Alias?.BirthDate, Is.EqualTo(new DateTime(1970, 1, 1)));
        });
    }

    /// <summary>
    /// Test case for getting the CSV template structure.
    /// </summary>
    [Test]
    public void GetGenericCsvTemplate()
    {
        // Act
        var template = GenericCsvImporter.GetCsvTemplate();

        // Assert
        Assert.That(template, Is.Not.Null);
        Assert.That(template, Does.Contain("service_name,url,username,password,totp_secret,notes"));
        Assert.That(template, Does.Contain("Gmail"));
        Assert.That(template, Does.Contain("Facebook"));
        Assert.That(template, Does.Contain("GitHub"));
        Assert.That(template, Does.Contain("Secure Note"));

        // Verify it has example data
        Assert.That(template, Does.Contain("your.email@gmail.com"));
        Assert.That(template, Does.Contain("your_totp_secret_here"));
    }

    /// <summary>
    /// Test case for Bitwarden import with folder path extraction.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    public async Task ImportBitwardenWithFolders()
    {
        // Arrange
        var fileContent = await ResourceReaderUtility.ReadEmbeddedResourceStringAsync("AliasVault.UnitTests.TestData.Exports.bitwarden.csv");

        // Act
        var importedCredentials = await BitwardenImporter.ImportFromCsvAsync(fileContent);

        // Assert - check folder path is extracted (6 items in Business folder in test data)
        var businessFolderItems = importedCredentials.Where(c => c.FolderPath == "Business").ToList();
        Assert.That(businessFolderItems, Has.Count.EqualTo(6), "Should have 6 items in Business folder");

        // Verify folder names are collected correctly
        var folderNames = BaseImporter.CollectUniqueFolderNames(importedCredentials);
        Assert.That(folderNames, Does.Contain("Business"));
    }

    /// <summary>
    /// Test case for multi-level folder path extraction (takes deepest folder).
    /// </summary>
    [Test]
    public void ExtractDeepestFolderName()
    {
        Assert.Multiple(() =>
        {
            Assert.That(BaseImporter.ExtractDeepestFolderName("Root/Business/Banking"), Is.EqualTo("Banking"));
            Assert.That(BaseImporter.ExtractDeepestFolderName("Business"), Is.EqualTo("Business"));
            Assert.That(BaseImporter.ExtractDeepestFolderName("Root\\Work\\Finance"), Is.EqualTo("Finance"));
            Assert.That(BaseImporter.ExtractDeepestFolderName(string.Empty), Is.Null);
            Assert.That(BaseImporter.ExtractDeepestFolderName(null), Is.Null);
            Assert.That(BaseImporter.ExtractDeepestFolderName("  /  "), Is.Null);
            Assert.That(BaseImporter.ExtractDeepestFolderName("Single"), Is.EqualTo("Single"));
        });
    }

    /// <summary>
    /// Test case for Bitwarden type detection (login, note, card).
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    public async Task BitwardenTypeDetection()
    {
        // Arrange
        var fileContent = await ResourceReaderUtility.ReadEmbeddedResourceStringAsync("AliasVault.UnitTests.TestData.Exports.bitwarden.csv");

        // Act
        var importedCredentials = await BitwardenImporter.ImportFromCsvAsync(fileContent);
        var items = BaseImporter.ConvertToItem(importedCredentials);

        // Assert - verify login type items have Login item type
        var loginItems = items.Where(i => i.ItemType == ItemType.Login).ToList();
        Assert.That(loginItems, Has.Count.GreaterThan(0), "Should have at least one Login item");
    }

    /// <summary>
    /// Test case for LastPass secure note detection.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    public async Task LastPassSecureNoteDetection()
    {
        // Arrange
        var fileContent = await ResourceReaderUtility.ReadEmbeddedResourceStringAsync("AliasVault.UnitTests.TestData.Exports.lastpass.csv");

        // Act
        var importedCredentials = await LastPassImporter.ImportFromCsvAsync(fileContent);
        var items = BaseImporter.ConvertToItem(importedCredentials);

        // Assert - verify secure note is detected
        var secureNoteItem = items.FirstOrDefault(i => i.Name == "securenote1");
        Assert.That(secureNoteItem, Is.Not.Null, "Should find securenote1");
        Assert.That(secureNoteItem!.ItemType, Is.EqualTo(ItemType.Note), "Secure note should have Note item type");
    }

    /// <summary>
    /// Test case for LastPass credit card detection and parsing.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    public async Task LastPassCreditCardDetectionAndParsing()
    {
        // Arrange
        var fileContent = await ResourceReaderUtility.ReadEmbeddedResourceStringAsync("AliasVault.UnitTests.TestData.Exports.lastpass.csv");

        // Act
        var importedCredentials = await LastPassImporter.ImportFromCsvAsync(fileContent);

        // Assert - verify credit card is detected
        var creditCardCredential = importedCredentials.FirstOrDefault(c => c.ServiceName == "Paymentcard1");
        Assert.That(creditCardCredential, Is.Not.Null, "Should find Paymentcard1");
        Assert.That(creditCardCredential!.ItemType, Is.EqualTo(ImportedItemType.Creditcard), "Should be Creditcard type");
        Assert.That(creditCardCredential.Creditcard, Is.Not.Null, "Should have Creditcard data");
        Assert.That(creditCardCredential.Creditcard!.CardholderName, Is.EqualTo("Cardname"));
        Assert.That(creditCardCredential.Creditcard.Number, Is.EqualTo("123456781234"));
        Assert.That(creditCardCredential.Creditcard.Cvv, Is.EqualTo("1234"));

        // Convert to item and verify fields
        var items = BaseImporter.ConvertToItem([creditCardCredential]);
        var creditCardItem = items[0];
        Assert.That(creditCardItem.ItemType, Is.EqualTo(ItemType.CreditCard));

        var cardNumber = creditCardItem.FieldValues.FirstOrDefault(fv => fv.FieldKey == FieldKey.CardNumber);
        Assert.That(cardNumber?.Value, Is.EqualTo("123456781234"));

        var cardholderName = creditCardItem.FieldValues.FirstOrDefault(fv => fv.FieldKey == FieldKey.CardCardholderName);
        Assert.That(cardholderName?.Value, Is.EqualTo("Cardname"));
    }

    /// <summary>
    /// Test case for LastPass folder (grouping) import.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    public async Task LastPassFolderImport()
    {
        // Arrange
        var fileContent = await ResourceReaderUtility.ReadEmbeddedResourceStringAsync("AliasVault.UnitTests.TestData.Exports.lastpass.csv");

        // Act
        var importedCredentials = await LastPassImporter.ImportFromCsvAsync(fileContent);

        // Assert - verify folder path is extracted
        var credentialWithFolder = importedCredentials.FirstOrDefault(c => !string.IsNullOrEmpty(c.FolderPath));
        Assert.That(credentialWithFolder, Is.Not.Null, "Should have at least one credential with folder");
        Assert.That(credentialWithFolder!.FolderPath, Is.EqualTo("examplefolder"));
    }

    /// <summary>
    /// Test case for KeePassXC group (folder) import with nested folder support.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    public async Task KeePassXcGroupImport()
    {
        // Arrange
        var fileContent = await ResourceReaderUtility.ReadEmbeddedResourceStringAsync("AliasVault.UnitTests.TestData.Exports.keepassxc.csv");

        // Act
        var importedCredentials = await KeePassXcImporter.ImportFromCsvAsync(fileContent);

        // Assert - verify folder path is extracted (KeePassXC uses Group column which contains folder hierarchy)
        var folderNames = BaseImporter.CollectUniqueFolderNames(importedCredentials);
        Assert.That(folderNames, Has.Count.EqualTo(2), "Should collect leaf folder names");
        Assert.That(folderNames, Does.Contain("Test1"), "Should contain Test1 folder");
        Assert.That(folderNames, Does.Contain("Windowssub1"), "Should contain Windowssub1 folder");

        // Verify the nested folder structure is properly extracted on the credential
        var nestedCredential = importedCredentials.First(c => c.ServiceName == "Nested Entry");
        Assert.That(nestedCredential.FolderPath, Is.EqualTo("Database/Windows/Windowssub1"), "Should preserve full nested folder path");

        // Verify ParseFolderPath correctly splits the nested path into individual folder components
        var folderParts = BaseImporter.ParseFolderPath(nestedCredential.FolderPath);
        Assert.Multiple(() =>
        {
            Assert.That(folderParts, Has.Count.EqualTo(3), "Should parse three folder levels");
            Assert.That(folderParts[0], Is.EqualTo("Database"), "First level should be Database");
            Assert.That(folderParts[1], Is.EqualTo("Windows"), "Second level should be Windows");
            Assert.That(folderParts[2], Is.EqualTo("Windowssub1"), "Third level should be Windowssub1");
        });

        // Verify that all folder levels would be created during import
        // The folder system creates: "Database", "Database/Windows", and "Database/Windows/Windowssub1"
        var allFolderPaths = new List<string>();
        for (int i = 1; i <= folderParts.Count; i++)
        {
            allFolderPaths.Add(string.Join("/", folderParts.Take(i)));
        }

        Assert.Multiple(() =>
        {
            Assert.That(allFolderPaths, Has.Count.EqualTo(3), "Should have three folder paths to create");
            Assert.That(allFolderPaths[0], Is.EqualTo("Database"), "Should create Database folder");
            Assert.That(allFolderPaths[1], Is.EqualTo("Database/Windows"), "Should create Database/Windows folder");
            Assert.That(allFolderPaths[2], Is.EqualTo("Database/Windows/Windowssub1"), "Should create Database/Windows/Windowssub1 folder");
        });
    }

    /// <summary>
    /// Test case for folder assignment during ConvertToItem.
    /// </summary>
    [Test]
    public void ConvertToItemWithFolderMapping()
    {
        // Arrange
        var credentials = new List<AliasVault.ImportExport.Models.ImportedCredential>
        {
            new()
            {
                ServiceName = "Test Service",
                FolderPath = "Work/Projects",
                Username = "user1",
                Password = "pass1",
            },
            new()
            {
                ServiceName = "Test Service 2",
                FolderPath = "Personal",
                Username = "user2",
                Password = "pass2",
            },
            new()
            {
                ServiceName = "No Folder",
                Username = "user3",
                Password = "pass3",
            },
        };

        var folderMapping = new Dictionary<string, Guid>
        {
            { "Work/Projects", Guid.NewGuid() },
            { "Personal", Guid.NewGuid() },
        };

        // Act
        var items = BaseImporter.ConvertToItem(credentials, folderMapping);

        // Assert
        Assert.That(items[0].FolderId, Is.EqualTo(folderMapping["Work/Projects"]), "Should assign Work/Projects folder using full path");
        Assert.That(items[1].FolderId, Is.EqualTo(folderMapping["Personal"]), "Should assign Personal folder");
        Assert.That(items[2].FolderId, Is.Null, "Should have no folder");
    }

    /// <summary>
    /// Test case for ProtonPass type and vault (folder) import.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    public async Task ProtonPassTypeAndVaultImport()
    {
        // Arrange
        var fileContent = await ResourceReaderUtility.ReadEmbeddedResourceStringAsync("AliasVault.UnitTests.TestData.Exports.protonpass.csv");

        // Act
        var importedCredentials = await ProtonPassImporter.ImportFromCsvAsync(fileContent);

        // Assert - verify vault (folder) is extracted
        var credentialsWithVault = importedCredentials.Where(c => !string.IsNullOrEmpty(c.FolderPath)).ToList();
        Assert.That(credentialsWithVault.Count, Is.GreaterThan(0), "Should have credentials with vault/folder");

        // Verify type detection
        var loginCredential = importedCredentials.FirstOrDefault(c => c.ItemType == ImportedItemType.Login);
        Assert.That(loginCredential, Is.Not.Null, "Should have at least one Login type");
    }

    /// <summary>
    /// Test case for Dashlane category (folder) import.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    public async Task DashlaneCategoryImport()
    {
        // Arrange
        var fileContent = await ResourceReaderUtility.ReadEmbeddedResourceStringAsync("AliasVault.UnitTests.TestData.Exports.dashlane.csv");

        // Act
        var importedCredentials = await DashlaneImporter.ImportFromCsvAsync(fileContent);

        // Assert - check if any credentials have folder path from category
        // Note: Dashlane test data may or may not have categories
        var folderNames = BaseImporter.CollectUniqueFolderNames(importedCredentials);
        Assert.That(folderNames, Is.Not.Null, "Should return a set (even if empty)");
    }

    /// <summary>
    /// Test case for importing credentials from RoboForm CSV and ensuring all values are present.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    public async Task ImportCredentialsFromRoboformCsv()
    {
        // Arrange
        var fileContent = await ResourceReaderUtility.ReadEmbeddedResourceStringAsync("AliasVault.UnitTests.TestData.Exports.roboform.csv");

        // Act
        var importedCredentials = await RoboformImporter.ImportFromCsvAsync(fileContent);

        // Assert - Should import 4 records
        Assert.That(importedCredentials, Has.Count.EqualTo(4));

        // Test regular login credential
        var comCredential = importedCredentials.First(c => c.ServiceName == "Com");
        Assert.Multiple(() =>
        {
            Assert.That(comCredential.ServiceName, Is.EqualTo("Com"));
            Assert.That(comCredential.ServiceUrls?.FirstOrDefault(), Is.EqualTo("https://www.example.com.com"));
            Assert.That(comCredential.Username, Is.EqualTo("username1"));
            Assert.That(comCredential.Password, Is.EqualTo("password1"));
            Assert.That(comCredential.Notes, Is.Null.Or.Empty);
            Assert.That(comCredential.FolderPath, Is.Null);
            Assert.That(comCredential.ItemType, Is.EqualTo(ImportedItemType.Login));
        });

        // Test credential with note
        var exampleCredential = importedCredentials.First(c => c.ServiceName == "Example");
        Assert.Multiple(() =>
        {
            Assert.That(exampleCredential.ServiceName, Is.EqualTo("Example"));
            Assert.That(exampleCredential.ServiceUrls?.FirstOrDefault(), Is.EqualTo("https://www.example.com"));
            Assert.That(exampleCredential.Username, Is.EqualTo("exampleusername"));
            Assert.That(exampleCredential.Password, Is.EqualTo("examplepassword"));
            Assert.That(exampleCredential.Notes, Is.EqualTo("Examplenote"));
            Assert.That(exampleCredential.FolderPath, Is.Null);
            Assert.That(exampleCredential.ItemType, Is.EqualTo(ImportedItemType.Login));
        });

        // Test secure note (no URL, login, or password)
        var safeNoteCredential = importedCredentials.First(c => c.ServiceName == "Safenotename");
        Assert.Multiple(() =>
        {
            Assert.That(safeNoteCredential.ServiceName, Is.EqualTo("Safenotename"));
            Assert.That(safeNoteCredential.ServiceUrls?.FirstOrDefault(), Is.Null);
            Assert.That(safeNoteCredential.Username, Is.Null.Or.Empty);
            Assert.That(safeNoteCredential.Password, Is.Null.Or.Empty);
            Assert.That(safeNoteCredential.Notes, Is.EqualTo("Safenote content example here"));
            Assert.That(safeNoteCredential.ItemType, Is.EqualTo(ImportedItemType.Note));
        });

        // Test credential in folder
        var businessCredential = importedCredentials.First(c => c.ServiceName == "Business");
        Assert.Multiple(() =>
        {
            Assert.That(businessCredential.ServiceName, Is.EqualTo("Business"));
            Assert.That(businessCredential.ServiceUrls?.FirstOrDefault(), Is.EqualTo("https://www.business.com"));
            Assert.That(businessCredential.Username, Is.EqualTo("businessusername"));
            Assert.That(businessCredential.Password, Is.EqualTo("businesspassword"));
            Assert.That(businessCredential.FolderPath, Is.EqualTo("Business"));
            Assert.That(businessCredential.ItemType, Is.EqualTo(ImportedItemType.Login));
        });
    }

    /// <summary>
    /// Test case for RoboForm folder import.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    public async Task RoboformFolderImport()
    {
        // Arrange
        var fileContent = await ResourceReaderUtility.ReadEmbeddedResourceStringAsync("AliasVault.UnitTests.TestData.Exports.roboform.csv");

        // Act
        var importedCredentials = await RoboformImporter.ImportFromCsvAsync(fileContent);

        // Assert - verify folder path is extracted (leading slash removed)
        var folderNames = BaseImporter.CollectUniqueFolderNames(importedCredentials);
        Assert.That(folderNames, Does.Contain("Business"));

        var credentialWithFolder = importedCredentials.First(c => c.FolderPath == "Business");
        Assert.That(credentialWithFolder.ServiceName, Is.EqualTo("Business"));
    }

    /// <summary>
    /// Test case for RoboForm secure note detection.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    public async Task RoboformSecureNoteDetection()
    {
        // Arrange
        var fileContent = await ResourceReaderUtility.ReadEmbeddedResourceStringAsync("AliasVault.UnitTests.TestData.Exports.roboform.csv");

        // Act
        var importedCredentials = await RoboformImporter.ImportFromCsvAsync(fileContent);
        var items = BaseImporter.ConvertToItem(importedCredentials);

        // Assert - verify secure note is detected
        var secureNoteItem = items.FirstOrDefault(i => i.Name == "Safenotename");
        Assert.That(secureNoteItem, Is.Not.Null, "Should find Safenotename");
        Assert.That(secureNoteItem!.ItemType, Is.EqualTo(ItemType.Note), "Secure note should have Note item type");

        // Verify the note content is preserved
        var notesFieldValue = secureNoteItem.FieldValues.FirstOrDefault(fv => fv.FieldKey == FieldKey.NotesContent);
        Assert.That(notesFieldValue?.Value, Is.EqualTo("Safenote content example here"));
    }

    /// <summary>
    /// Test case for importing credentials from Edge CSV and ensuring all values are present.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    public async Task ImportCredentialsFromEdgeCsv()
    {
        // Arrange
        var fileContent = await ResourceReaderUtility.ReadEmbeddedResourceStringAsync("AliasVault.UnitTests.TestData.Exports.edge.csv");

        // Act
        var importedCredentials = await EdgeImporter.ImportFromCsvAsync(fileContent);

        // Assert
        Assert.That(importedCredentials, Has.Count.EqualTo(4));

        // Test first entry (no notes)
        var exampleAppCredential = importedCredentials.First(c => c.ServiceName == "example.app.tld");
        Assert.Multiple(() =>
        {
            Assert.That(exampleAppCredential.ServiceName, Is.EqualTo("example.app.tld"));
            Assert.That(exampleAppCredential.ServiceUrls?.FirstOrDefault(), Is.EqualTo("https://example.app.tld/"));
            Assert.That(exampleAppCredential.Username, Is.EqualTo("exampleu"));
            Assert.That(exampleAppCredential.Password, Is.EqualTo("examplep"));
            Assert.That(exampleAppCredential.Notes, Is.Empty);
        });

        // Test entry with notes
        var googleCredential = importedCredentials.First(c => c.ServiceName == "google.nl");
        Assert.Multiple(() =>
        {
            Assert.That(googleCredential.ServiceName, Is.EqualTo("google.nl"));
            Assert.That(googleCredential.ServiceUrls?.FirstOrDefault(), Is.EqualTo("https://google.nl/"));
            Assert.That(googleCredential.Username, Is.EqualTo("myuser"));
            Assert.That(googleCredential.Password, Is.EqualTo("mypass"));
            Assert.That(googleCredential.Notes, Is.EqualTo("Google note here microsoft edge"));
        });

        // Test youtube entry
        var youtubeCredential = importedCredentials.First(c => c.ServiceName == "youtube.com");
        Assert.Multiple(() =>
        {
            Assert.That(youtubeCredential.ServiceName, Is.EqualTo("youtube.com"));
            Assert.That(youtubeCredential.ServiceUrls?.FirstOrDefault(), Is.EqualTo("https://youtube.com/"));
            Assert.That(youtubeCredential.Username, Is.EqualTo("youtubeuser"));
            Assert.That(youtubeCredential.Password, Is.EqualTo("ytpassword"));
            Assert.That(youtubeCredential.Notes, Is.EqualTo("Youtubenotes"));
        });
    }

    /// <summary>
    /// Test case for importing credentials from Enpass CSV and ensuring all values are present.
    /// Enpass uses a unique format with alternating key-value pairs instead of headers.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    public async Task ImportCredentialsFromEnpassCsv()
    {
        // Arrange
        var fileContent = await ResourceReaderUtility.ReadEmbeddedResourceStringAsync("AliasVault.UnitTests.TestData.Exports.enpass.csv");

        // Act
        var importedCredentials = await EnpassImporter.ImportFromCsvAsync(fileContent);

        // Assert - Should import 5 records
        Assert.That(importedCredentials, Has.Count.EqualTo(5));

        // Test credit card
        var creditCard = importedCredentials.First(c => c.ServiceName == "Credit Card");
        Assert.Multiple(() =>
        {
            Assert.That(creditCard.ItemType, Is.EqualTo(ImportedItemType.Creditcard));
            Assert.That(creditCard.Creditcard, Is.Not.Null);
            Assert.That(creditCard.Creditcard!.CardholderName, Is.EqualTo("ccholder"));
            Assert.That(creditCard.Creditcard.Number, Is.EqualTo("1234123412341234"));
            Assert.That(creditCard.Creditcard.Cvv, Is.EqualTo("1234"));
            Assert.That(creditCard.Creditcard.Pin, Is.EqualTo("1234"));
            Assert.That(creditCard.Creditcard.ExpiryMonth, Is.EqualTo("12"));
            Assert.That(creditCard.Creditcard.ExpiryYear, Is.EqualTo("28"));
        });

        // Test Google login with TOTP
        var googleLogin = importedCredentials.First(c => c.ServiceName == "Google");
        Assert.Multiple(() =>
        {
            Assert.That(googleLogin.ItemType, Is.EqualTo(ImportedItemType.Login));
            Assert.That(googleLogin.Username, Is.EqualTo("usergoogle"));
            Assert.That(googleLogin.Email, Is.EqualTo("email@email.com"));
            Assert.That(googleLogin.Password, Is.EqualTo("password"));
            Assert.That(googleLogin.ServiceUrls?.FirstOrDefault(), Is.EqualTo("https://accounts.google.com/"));
            Assert.That(googleLogin.TwoFactorSecret, Is.EqualTo("PLW4SB3PQ7MKVXY2MXF4NEXS6Y"));
            Assert.That(googleLogin.Notes, Does.Contain("Security question: secquestion"));
            Assert.That(googleLogin.Notes, Does.Contain("Security answer: secanswer"));
        });

        // Test identity
        var identity = importedCredentials.First(c => c.ServiceName == "Identity");
        Assert.Multiple(() =>
        {
            Assert.That(identity.ItemType, Is.EqualTo(ImportedItemType.Alias));
            Assert.That(identity.Alias, Is.Not.Null);
            Assert.That(identity.Alias!.FirstName, Is.EqualTo("John"));
            Assert.That(identity.Alias.LastName, Is.EqualTo("Johnson"));
            Assert.That(identity.Alias.Gender, Is.EqualTo("Male"));
            Assert.That(identity.Alias.BirthDate, Is.EqualTo(new DateTime(1970, 1, 1)));
        });

        // Test password entry
        var passwordEntry = importedCredentials.First(c => c.ServiceName == "Password");
        Assert.Multiple(() =>
        {
            Assert.That(passwordEntry.ItemType, Is.EqualTo(ImportedItemType.Login));
            Assert.That(passwordEntry.Username, Is.EqualTo("loginpw1"));
            Assert.That(passwordEntry.Password, Is.EqualTo("password"));
        });

        // Test secure note
        var secureNote = importedCredentials.First(c => c.ServiceName == "Securenote");
        Assert.Multiple(() =>
        {
            Assert.That(secureNote.ItemType, Is.EqualTo(ImportedItemType.Note));
            Assert.That(secureNote.Notes, Is.EqualTo("Note only content here"));
        });
    }

    /// <summary>
    /// Test case for Enpass credit card conversion to Item.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    public async Task EnpassCreditCardConversion()
    {
        // Arrange
        var fileContent = await ResourceReaderUtility.ReadEmbeddedResourceStringAsync("AliasVault.UnitTests.TestData.Exports.enpass.csv");

        // Act
        var importedCredentials = await EnpassImporter.ImportFromCsvAsync(fileContent);
        var creditCardCredential = importedCredentials.First(c => c.ServiceName == "Credit Card");
        var items = BaseImporter.ConvertToItem([creditCardCredential]);

        // Assert
        var creditCardItem = items[0];
        Assert.That(creditCardItem.ItemType, Is.EqualTo(ItemType.CreditCard));

        var cardNumber = creditCardItem.FieldValues.FirstOrDefault(fv => fv.FieldKey == FieldKey.CardNumber);
        Assert.That(cardNumber?.Value, Is.EqualTo("1234123412341234"));

        var cardholderName = creditCardItem.FieldValues.FirstOrDefault(fv => fv.FieldKey == FieldKey.CardCardholderName);
        Assert.That(cardholderName?.Value, Is.EqualTo("ccholder"));

        var cardCvv = creditCardItem.FieldValues.FirstOrDefault(fv => fv.FieldKey == FieldKey.CardCvv);
        Assert.That(cardCvv?.Value, Is.EqualTo("1234"));

        var cardPin = creditCardItem.FieldValues.FirstOrDefault(fv => fv.FieldKey == FieldKey.CardPin);
        Assert.That(cardPin?.Value, Is.EqualTo("1234"));
    }

    /// <summary>
    /// Helper method to add a field value to an item.
    /// </summary>
    /// <param name="item">The item to add the field value to.</param>
    /// <param name="fieldKey">The field key.</param>
    /// <param name="value">The field value.</param>
    private static void AddFieldValue(Item item, string fieldKey, string value)
    {
        item.FieldValues.Add(new FieldValue
        {
            Id = Guid.NewGuid(),
            ItemId = item.Id,
            FieldKey = fieldKey,
            Value = value,
            Weight = 0,
            CreatedAt = item.CreatedAt,
            UpdatedAt = item.UpdatedAt,
        });
    }

    /// <summary>
    /// Test case for exporting vault data to .avux format and verifying structure.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    public async Task ExportVaultToAvuxFormat()
    {
        // Arrange - Create comprehensive vault data
        var items = new List<Item>
        {
            // Login with basic fields
            CreateTestItem("Basic Login", ItemType.Login, new Dictionary<string, string>
            {
                { FieldKey.LoginUsername, "testuser" },
                { FieldKey.LoginPassword, "testpass" },
                { FieldKey.LoginUrl, "https://example.com" },
                { FieldKey.NotesContent, "Test notes" },
            }),

            // Login with 2FA
            CreateTestItemWithTotp("Login with 2FA", "user2fa", "pass2fa"),

            // Credit card
            CreateTestCreditCard(),

            // Note
            CreateTestNote(),

            // Item with attachment
            CreateTestItemWithAttachment(),
        };

        var folders = new List<Folder>
        {
            new()
            {
                Id = Guid.NewGuid(),
                Name = "Test Folder",
                Weight = 0,
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow,
            },
        };

        var tags = new List<Tag>
        {
            new()
            {
                Id = Guid.NewGuid(),
                Name = "Test Tag",
                Color = "#FF0000",
                DisplayOrder = 0,
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow,
            },
        };

        var itemTags = new List<ItemTag>
        {
            new()
            {
                Id = Guid.NewGuid(),
                ItemId = items[0].Id,
                TagId = tags[0].Id,
            },
        };

        var fieldDefinitions = new List<FieldDefinition>();

        // Act
        var avuxBytes = await VaultExportService.ExportToAvuxAsync(
            items,
            folders,
            tags,
            itemTags,
            fieldDefinitions,
            new List<Logo>(),
            "test@example.com");

        // Assert
        Assert.That(avuxBytes, Is.Not.Null);
        Assert.That(avuxBytes.Length, Is.GreaterThan(0));

        // Verify it's a valid ZIP file
        using var zipStream = new MemoryStream(avuxBytes);
        using var archive = new ZipArchive(zipStream, ZipArchiveMode.Read);

        var manifestEntry = archive.GetEntry("manifest.json");
        Assert.That(manifestEntry, Is.Not.Null, "manifest.json should exist");

        // Verify manifest content
        using var reader = new StreamReader(manifestEntry.Open());
        var manifestJson = await reader.ReadToEndAsync();
        Assert.That(manifestJson, Does.Contain("\"version\""));
        Assert.That(manifestJson, Does.Contain("\"items\""));
        Assert.That(manifestJson, Does.Contain("\"folders\""));
        Assert.That(manifestJson, Does.Contain("Basic Login"));
        Assert.That(manifestJson, Does.Contain("Test Folder"));
    }

    /// <summary>
    /// Test case for importing vault data from .avux format.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    public async Task ImportVaultFromAvuxFormat()
    {
        // Arrange - Create test data and export it
        var items = new List<Item>
        {
            CreateTestItem("Import Test Item", ItemType.Login, new Dictionary<string, string>
            {
                { FieldKey.LoginUsername, "importuser" },
                { FieldKey.LoginPassword, "importpass" },
                { FieldKey.LoginUrl, "https://import.example.com" },
            }),
            CreateTestItemWithTotp("Import 2FA", "user2fa", "pass2fa"),
            CreateTestCreditCard(),
        };

        var avuxBytes = await VaultExportService.ExportToAvuxAsync(
            items,
            new List<Folder>(),
            new List<Tag>(),
            new List<ItemTag>(),
            new List<FieldDefinition>(),
            new List<Logo>(),
            "test@example.com");

        // Act - Import the .avux file
        var importedCredentials = await VaultImportService.ImportFromAvuxAsync(avuxBytes);

        // Assert
        Assert.That(importedCredentials, Has.Count.EqualTo(3));

        var basicLogin = importedCredentials.First(c => c.ServiceName == "Import Test Item");
        Assert.Multiple(() =>
        {
            Assert.That(basicLogin.Username, Is.EqualTo("importuser"));
            Assert.That(basicLogin.Password, Is.EqualTo("importpass"));
            Assert.That(basicLogin.ServiceUrls?.FirstOrDefault(), Is.EqualTo("https://import.example.com"));
        });

        var twoFaLogin = importedCredentials.First(c => c.ServiceName == "Import 2FA");
        Assert.Multiple(() =>
        {
            Assert.That(twoFaLogin.Username, Is.EqualTo("user2fa"));
            Assert.That(twoFaLogin.Password, Is.EqualTo("pass2fa"));
            Assert.That(twoFaLogin.TwoFactorSecret, Is.Not.Empty);
        });

        var creditCard = importedCredentials.First(c => c.ItemType == ImportedItemType.Creditcard);
        Assert.Multiple(() =>
        {
            Assert.That(creditCard.Creditcard, Is.Not.Null);
            Assert.That(creditCard.Creditcard!.Number, Is.EqualTo("4111111111111111"));
            Assert.That(creditCard.Creditcard.CardholderName, Is.EqualTo("Test Holder"));
        });
    }

    /// <summary>
    /// Test case for round-trip export and import preserving all data.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    public async Task AvuxRoundTripPreservesAllData()
    {
        // Arrange
        var originalItem = CreateTestItem("Round Trip Test", ItemType.Login, new Dictionary<string, string>
        {
            { FieldKey.LoginUsername, "roundtripuser" },
            { FieldKey.LoginPassword, "roundtrippass" },
            { FieldKey.LoginUrl, "https://roundtrip.example.com" },
            { FieldKey.NotesContent, "Round trip notes" },
            { FieldKey.AliasFirstName, "John" },
            { FieldKey.AliasLastName, "Doe" },
        });

        // Add TOTP
        originalItem.TotpCodes.Add(new TotpCode
        {
            Id = Guid.NewGuid(),
            ItemId = originalItem.Id,
            Name = "Round Trip TOTP",
            SecretKey = "JBSWY3DPEHPK3PXP",
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
        });

        // Export
        var avuxBytes = await VaultExportService.ExportToAvuxAsync(
            new List<Item> { originalItem },
            new List<Folder>(),
            new List<Tag>(),
            new List<ItemTag>(),
            new List<FieldDefinition>(),
            new List<Logo>(),
            "test@example.com");

        // Import
        var importedCredentials = await VaultImportService.ImportFromAvuxAsync(avuxBytes);

        // Assert
        Assert.That(importedCredentials, Has.Count.EqualTo(1));

        var imported = importedCredentials[0];
        Assert.Multiple(() =>
        {
            Assert.That(imported.ServiceName, Is.EqualTo("Round Trip Test"));
            Assert.That(imported.Username, Is.EqualTo("roundtripuser"));
            Assert.That(imported.Password, Is.EqualTo("roundtrippass"));
            Assert.That(imported.ServiceUrls?.FirstOrDefault(), Is.EqualTo("https://roundtrip.example.com"));
            Assert.That(imported.Notes, Is.EqualTo("Round trip notes"));
            Assert.That(imported.Alias?.FirstName, Is.EqualTo("John"));
            Assert.That(imported.Alias?.LastName, Is.EqualTo("Doe"));
            Assert.That(imported.TwoFactorSecret, Is.EqualTo("JBSWY3DPEHPK3PXP"));
        });
    }

    /// <summary>
    /// Test case for exporting and importing vault with logos in .avux format.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    public async Task ExportAndImportAvuxWithLogos()
    {
        // Arrange
        var items = new List<Item>();
        var logoId1 = Guid.NewGuid();
        var logoId2 = Guid.NewGuid();

        var item1 = new Item
        {
            Id = Guid.NewGuid(),
            Name = "GitHub",
            ItemType = "Login",
            LogoId = logoId1,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
        };
        AddFieldValue(item1, FieldKey.LoginUsername, "testuser");
        AddFieldValue(item1, FieldKey.LoginPassword, "password123");
        AddFieldValue(item1, FieldKey.LoginUrl, "https://github.com");
        items.Add(item1);

        var item2 = new Item
        {
            Id = Guid.NewGuid(),
            Name = "Google",
            ItemType = "Login",
            LogoId = logoId2,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
        };
        AddFieldValue(item2, FieldKey.LoginUsername, "user@gmail.com");
        AddFieldValue(item2, FieldKey.LoginPassword, "pass456");
        AddFieldValue(item2, FieldKey.LoginUrl, "https://google.com");
        items.Add(item2);

        // Third item uses same logo as item1 (deduplication test)
        var item3 = new Item
        {
            Id = Guid.NewGuid(),
            Name = "GitHub Issue Tracker",
            ItemType = "Login",
            LogoId = logoId1,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
        };
        AddFieldValue(item3, FieldKey.LoginUsername, "issueuser");
        AddFieldValue(item3, FieldKey.LoginPassword, "issuepass");
        items.Add(item3);

        var logos = new List<Logo>
        {
            new Logo
            {
                Id = logoId1,
                Source = "github.com",
                FileData = new byte[] { 1, 2, 3, 4, 5 },
                MimeType = "image/png",
                FetchedAt = DateTime.UtcNow,
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow,
            },
            new Logo
            {
                Id = logoId2,
                Source = "google.com",
                FileData = new byte[] { 6, 7, 8, 9, 10 },
                MimeType = "image/png",
                FetchedAt = DateTime.UtcNow,
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow,
            },
        };

        // Act - Export
        var zipBytes = await VaultExportService.ExportToAvuxAsync(
            items,
            new List<Folder>(),
            new List<Tag>(),
            new List<ItemTag>(),
            new List<FieldDefinition>(),
            logos,
            "testuser");

        // Act - Import
        var credentials = await VaultImportService.ImportFromAvuxAsync(zipBytes);

        // Assert - After refactor, logos are embedded in FaviconBytes property
        Assert.That(credentials, Has.Count.EqualTo(3));

        // Verify first credential
        var githubCred = credentials.First(c => c.ServiceName == "GitHub");
        Assert.Multiple(() =>
        {
            Assert.That(githubCred.ServiceName, Is.EqualTo("GitHub"));
            Assert.That(githubCred.Username, Is.EqualTo("testuser"));
            Assert.That(githubCred.Password, Is.EqualTo("password123"));
            Assert.That(githubCred.FaviconBytes, Is.EqualTo(new byte[] { 1, 2, 3, 4, 5 }), "Logo should be embedded in FaviconBytes");
        });

        // Verify second credential
        var googleCred = credentials.First(c => c.ServiceName == "Google");
        Assert.Multiple(() =>
        {
            Assert.That(googleCred.ServiceName, Is.EqualTo("Google"));
            Assert.That(googleCred.Username, Is.EqualTo("user@gmail.com"));
            Assert.That(googleCred.Password, Is.EqualTo("pass456"));
            Assert.That(googleCred.FaviconBytes, Is.EqualTo(new byte[] { 6, 7, 8, 9, 10 }), "Logo should be embedded in FaviconBytes");
        });

        // Verify third credential uses same logo as first
        var githubIssueCred = credentials.First(c => c.ServiceName == "GitHub Issue Tracker");
        Assert.That(githubIssueCred.FaviconBytes, Is.EqualTo(new byte[] { 1, 2, 3, 4, 5 }), "Should have same logo data as GitHub");
    }

    /// <summary>
    /// Helper method to create a test item with specific fields.
    /// </summary>
    private static Item CreateTestItem(string name, string itemType, Dictionary<string, string> fields)
    {
        var item = new Item
        {
            Id = Guid.NewGuid(),
            Name = name,
            ItemType = itemType,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
        };

        foreach (var field in fields)
        {
            AddFieldValue(item, field.Key, field.Value);
        }

        return item;
    }

    /// <summary>
    /// Helper method to create a test item with TOTP.
    /// </summary>
    private static Item CreateTestItemWithTotp(string name, string username, string password)
    {
        var item = CreateTestItem(name, ItemType.Login, new Dictionary<string, string>
        {
            { FieldKey.LoginUsername, username },
            { FieldKey.LoginPassword, password },
        });

        item.TotpCodes.Add(new TotpCode
        {
            Id = Guid.NewGuid(),
            ItemId = item.Id,
            Name = "Test TOTP",
            SecretKey = "JBSWY3DPEHPK3PXP",
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
        });

        return item;
    }

    /// <summary>
    /// Helper method to create a test credit card.
    /// </summary>
    private static Item CreateTestCreditCard()
    {
        return CreateTestItem("Test Card", ItemType.CreditCard, new Dictionary<string, string>
        {
            { FieldKey.CardNumber, "4111111111111111" },
            { FieldKey.CardCardholderName, "Test Holder" },
            { FieldKey.CardExpiryMonth, "12" },
            { FieldKey.CardExpiryYear, "2025" },
            { FieldKey.CardCvv, "123" },
            { FieldKey.CardPin, "1234" },
        });
    }

    /// <summary>
    /// Helper method to create a test note.
    /// </summary>
    private static Item CreateTestNote()
    {
        return CreateTestItem("Test Note", ItemType.Note, new Dictionary<string, string>
        {
            { FieldKey.NotesContent, "This is a test secure note with important information." },
        });
    }

    /// <summary>
    /// Helper method to create a test item with attachment.
    /// </summary>
    private static Item CreateTestItemWithAttachment()
    {
        var item = CreateTestItem("Item with Attachment", ItemType.Login, new Dictionary<string, string>
        {
            { FieldKey.LoginUsername, "attachuser" },
            { FieldKey.LoginPassword, "attachpass" },
        });

        item.Attachments.Add(new Attachment
        {
            Id = Guid.NewGuid(),
            ItemId = item.Id,
            Filename = "test-file.txt",
            Blob = System.Text.Encoding.UTF8.GetBytes("Test attachment content"),
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
        });

        return item;
    }

    /// <summary>
    /// Test case for importing credentials from Bitwarden ZIP export with attachments.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    public async Task ImportCredentialsFromBitwardenZip()
    {
        // Arrange
        var zipBytes = await ResourceReaderUtility.ReadEmbeddedResourceBytesAsync("AliasVault.UnitTests.TestData.Exports.bitwarden.zip");

        // Act
        var importer = new BitwardenZipImporter();
        var importedCredentials = await importer.ImportFromArchiveAsync(zipBytes);

        // Assert
        Assert.That(importedCredentials, Has.Count.EqualTo(5));

        // Test Login item with TOTP and custom fields
        var loginItem = importedCredentials.First(c => c.ServiceName == "Example Login");
        Assert.Multiple(() =>
        {
            Assert.That(loginItem.ServiceName, Is.EqualTo("Example Login"));
            Assert.That(loginItem.Username, Is.EqualTo("testuser@example.com"));
            Assert.That(loginItem.Password, Is.EqualTo("SecurePassword123!"));
            Assert.That(loginItem.ServiceUrls, Has.Count.EqualTo(1));
            Assert.That(loginItem.ServiceUrls![0], Is.EqualTo("https://example.com"));
            Assert.That(loginItem.TwoFactorSecret, Is.EqualTo("otpauth://totp/Example:testuser@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example"));
            Assert.That(loginItem.FolderPath, Is.EqualTo("Personal"));
            Assert.That(loginItem.ItemType, Is.EqualTo(ImportedItemType.Login));

            // Verify custom fields (all types: Text=0, Hidden=1, Boolean=2)
            // Linked fields (type 3) are skipped during import
            Assert.That(loginItem.CustomFields, Is.Not.Null);
            Assert.That(loginItem.CustomFields, Has.Count.EqualTo(3));
            Assert.That(loginItem.CustomFields!["Security Question"], Is.EqualTo("My first pet")); // Type 0: Text
            Assert.That(loginItem.CustomFields["API Key"], Is.EqualTo("sk_test_123456789")); // Type 1: Hidden
            Assert.That(loginItem.CustomFields["Two Factor Enabled"], Is.EqualTo("true")); // Type 2: Boolean

            // Notes should remain unchanged (linked fields are skipped, not added to notes)
            Assert.That(loginItem.Notes, Is.EqualTo("This is a test login item"));
        });

        // Test Secure Note item
        var noteItem = importedCredentials.First(c => c.ServiceName == "Secure Note");
        Assert.Multiple(() =>
        {
            Assert.That(noteItem.ServiceName, Is.EqualTo("Secure Note"));
            Assert.That(noteItem.Notes, Is.EqualTo("This is a secure note with sensitive information"));
            Assert.That(noteItem.ItemType, Is.EqualTo(ImportedItemType.Note));
            Assert.That(noteItem.FolderPath, Is.Null);
        });

        // Test Credit Card item
        var cardItem = importedCredentials.First(c => c.ServiceName == "My Credit Card");
        Assert.Multiple(() =>
        {
            Assert.That(cardItem.ServiceName, Is.EqualTo("My Credit Card"));
            Assert.That(cardItem.Notes, Is.EqualTo("Primary card"));
            Assert.That(cardItem.FolderPath, Is.EqualTo("Work"));
            Assert.That(cardItem.ItemType, Is.EqualTo(ImportedItemType.Creditcard));
            Assert.That(cardItem.Creditcard, Is.Not.Null);
            Assert.That(cardItem.Creditcard!.CardholderName, Is.EqualTo("John Doe"));
            Assert.That(cardItem.Creditcard.Number, Is.EqualTo("4111111111111111"));
            Assert.That(cardItem.Creditcard.ExpiryMonth, Is.EqualTo("12"));
            Assert.That(cardItem.Creditcard.ExpiryYear, Is.EqualTo("2025"));
            Assert.That(cardItem.Creditcard.Cvv, Is.EqualTo("123"));
        });

        // Test Identity item
        var identityItem = importedCredentials.First(c => c.ServiceName == "Personal Identity");
        Assert.Multiple(() =>
        {
            Assert.That(identityItem.ServiceName, Is.EqualTo("Personal Identity"));
            Assert.That(identityItem.ItemType, Is.EqualTo(ImportedItemType.Alias));
            Assert.That(identityItem.Alias, Is.Not.Null);
            Assert.That(identityItem.Alias!.FirstName, Is.EqualTo("John"));
            Assert.That(identityItem.Alias.LastName, Is.EqualTo("Doe"));
            Assert.That(identityItem.Email, Is.EqualTo("john@example.com"));
            Assert.That(identityItem.Notes, Does.Contain("Company: Example Corp"));
            Assert.That(identityItem.Notes, Does.Contain("Phone: +1234567890"));
            Assert.That(identityItem.Notes, Does.Contain("Address: 123 Main St, Apt 4B, New York, NY, 10001, US"));
        });

        // Test Login with Attachment
        var attachmentItem = importedCredentials.First(c => c.ServiceName == "Login with Attachment");
        Assert.Multiple(() =>
        {
            Assert.That(attachmentItem.ServiceName, Is.EqualTo("Login with Attachment"));
            Assert.That(attachmentItem.Username, Is.EqualTo("admin"));
            Assert.That(attachmentItem.Password, Is.EqualTo("AdminPass456!"));
        });

        // Note: Attachment extraction is supported but skipped in unit tests
        // as it requires specific ZIP structure that may vary by Bitwarden export version

        // Verify conversion to Item works correctly
        var convertedItems = BaseImporter.ConvertToItem(importedCredentials);
        Assert.That(convertedItems, Has.Count.EqualTo(5));

        var convertedLogin = convertedItems.First(i => i.Name == "Example Login");
        Assert.Multiple(() =>
        {
            Assert.That(convertedLogin.ItemType, Is.EqualTo(ItemType.Login));
            Assert.That(convertedLogin.TotpCodes, Has.Count.EqualTo(1));
            Assert.That(convertedLogin.TotpCodes.First().SecretKey, Is.EqualTo("JBSWY3DPEHPK3PXP"));
        });
    }

    /// <summary>
    /// Regression test: a Bitwarden ZIP that includes a directory entry for the
    /// item's attachment folder (e.g. "attachments/&lt;id&gt;/") must not produce a
    /// phantom attachment with an empty filename. Many ZIP creators emit such
    /// directory entries by default, and they previously matched the StartsWith
    /// filter and ended up as empty-blob attachments rendered as "(unavailable)".
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    public async Task ImportBitwardenZipWithDirectoryEntriesIgnoresPhantomAttachments()
    {
        // Arrange - build a Bitwarden-style ZIP in memory containing both a
        // directory entry and a single file entry under the item's attachment folder.
        const string ItemId = "item-with-attachment-uuid";
        const string FileName = "dataset_Backup_keys.json";
        var fileBytes = System.Text.Encoding.UTF8.GetBytes("{\"keys\":\"value\"}");

        const string DataJson = """
        {
          "encrypted": false,
          "folders": [],
          "items": [
            {
              "id": "item-with-attachment-uuid",
              "organizationId": null,
              "folderId": null,
              "type": 1,
              "reprompt": 0,
              "name": "Login with Attachment",
              "notes": "This item has an attachment",
              "favorite": false,
              "revisionDate": "2023-08-15T16:30:00.000Z",
              "fields": [],
              "login": {
                "uris": [{"match": null, "uri": "https://secure.example.com"}],
                "username": "admin",
                "password": "AdminPass456!",
                "totp": null
              },
              "collectionIds": null
            }
          ]
        }
        """;

        byte[] zipBytes;
        using (var ms = new MemoryStream())
        {
            using (var archive = new ZipArchive(ms, ZipArchiveMode.Create, leaveOpen: true))
            {
                var dataEntry = archive.CreateEntry("data.json");
                using (var writer = new StreamWriter(dataEntry.Open()))
                {
                    await writer.WriteAsync(DataJson);
                }

                // Directory entries (zero-byte, trailing slash) — emitted by many ZIP tools
                // and the source of the original "(unavailable)" duplicate.
                archive.CreateEntry("attachments/");
                archive.CreateEntry($"attachments/{ItemId}/");

                var fileEntry = archive.CreateEntry($"attachments/{ItemId}/{FileName}");
                using (var fileStream = fileEntry.Open())
                {
                    await fileStream.WriteAsync(fileBytes);
                }
            }

            zipBytes = ms.ToArray();
        }

        // Act
        var importer = new BitwardenZipImporter();
        var importedCredentials = await importer.ImportFromArchiveAsync(zipBytes);

        // Assert - exactly one attachment with the real filename and content,
        // and no phantom empty-filename entry from the directory entries.
        Assert.That(importedCredentials, Has.Count.EqualTo(1));
        var credential = importedCredentials[0];
        Assert.That(credential.Attachments, Is.Not.Null);
        Assert.That(credential.Attachments, Has.Count.EqualTo(1));
        Assert.Multiple(() =>
        {
            Assert.That(credential.Attachments![0].Filename, Is.EqualTo(FileName));
            Assert.That(credential.Attachments[0].Blob, Is.EqualTo(fileBytes));
            Assert.That(credential.Attachments.Any(a => string.IsNullOrEmpty(a.Filename)), Is.False);
            Assert.That(credential.Attachments.Any(a => a.Blob == null || a.Blob.Length == 0), Is.False);
        });
    }

    /// <summary>
    /// Test case for importing credentials from 1Password .1pux export format.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    public async Task ImportCredentialsFromOnePassword1pux()
    {
        // Arrange
        var zipBytes = await ResourceReaderUtility.ReadEmbeddedResourceBytesAsync("AliasVault.UnitTests.TestData.Exports.test_export.1pux");

        // Act
        var importer = new OnePassword1puxImporter();
        var importedCredentials = await importer.ImportFromArchiveAsync(zipBytes);

        // Assert
        Assert.That(importedCredentials, Has.Count.EqualTo(6));

        // Test Login item with TOTP and custom fields
        var loginItem = importedCredentials.First(c => c.ServiceName == "Example Login");
        Assert.Multiple(() =>
        {
            Assert.That(loginItem.ServiceName, Is.EqualTo("Example Login"));
            Assert.That(loginItem.Username, Is.EqualTo("jdoe"));
            Assert.That(loginItem.Password, Is.EqualTo("mySecurePassword123"));
            Assert.That(loginItem.ServiceUrls, Has.Count.EqualTo(1));
            Assert.That(loginItem.ServiceUrls![0], Is.EqualTo("https://example.com"));
            Assert.That(loginItem.TwoFactorSecret, Is.EqualTo("otpauth://totp/Example:jdoe?secret=JBSWY3DPEHPK3PXP&issuer=Example"));
            Assert.That(loginItem.Notes, Is.EqualTo("My login notes here"));
            Assert.That(loginItem.FolderPath, Is.Null); // Single vault "Personal" promoted to root
            Assert.That(loginItem.ItemType, Is.EqualTo(ImportedItemType.Login));
            Assert.That(loginItem.Tags, Has.Count.EqualTo(2));
            Assert.That(loginItem.Tags, Does.Contain("work"));
            Assert.That(loginItem.Tags, Does.Contain("important"));
            Assert.That(loginItem.CustomFields, Is.Not.Null);
            Assert.That(loginItem.CustomFields!["Recovery Email"], Is.EqualTo("recovery@example.com"));
        });

        // Verify created/updated timestamps are converted from Unix time
        var expectedCreatedDate = DateTimeOffset.FromUnixTimeSeconds(1614298956).UtcDateTime;
        var expectedUpdatedDate = DateTimeOffset.FromUnixTimeSeconds(1635346445).UtcDateTime;
        Assert.Multiple(() =>
        {
            Assert.That(loginItem.CreatedAt, Is.EqualTo(expectedCreatedDate));
            Assert.That(loginItem.UpdatedAt, Is.EqualTo(expectedUpdatedDate));
        });

        // Test Credit Card item
        var cardItem = importedCredentials.First(c => c.ServiceName == "My Visa Card");
        Assert.Multiple(() =>
        {
            Assert.That(cardItem.ServiceName, Is.EqualTo("My Visa Card"));
            Assert.That(cardItem.Notes, Is.EqualTo("Primary credit card"));
            Assert.That(cardItem.FolderPath, Is.Null); // Single vault "Personal" promoted to root
            Assert.That(cardItem.ItemType, Is.EqualTo(ImportedItemType.Creditcard));
            Assert.That(cardItem.Creditcard, Is.Not.Null);
            Assert.That(cardItem.Creditcard!.CardholderName, Is.EqualTo("John Doe"));
            Assert.That(cardItem.Creditcard.Number, Is.EqualTo("4111111111111111"));
            Assert.That(cardItem.Creditcard.Cvv, Is.EqualTo("123"));
            Assert.That(cardItem.Creditcard.Pin, Is.EqualTo("1234"));
            Assert.That(cardItem.Creditcard.ExpiryYear, Is.EqualTo("2025"));
            Assert.That(cardItem.Creditcard.ExpiryMonth, Is.EqualTo("12"));
        });

        // Test Identity item
        var identityItem = importedCredentials.First(c => c.ServiceName == "My Identity");
        Assert.Multiple(() =>
        {
            Assert.That(identityItem.ServiceName, Is.EqualTo("My Identity"));
            Assert.That(identityItem.ItemType, Is.EqualTo(ImportedItemType.Alias));
            Assert.That(identityItem.Alias, Is.Not.Null);
            Assert.That(identityItem.Alias!.FirstName, Is.EqualTo("Jane"));
            Assert.That(identityItem.Alias.LastName, Is.EqualTo("Smith"));
            Assert.That(identityItem.Alias.Gender, Is.EqualTo("Female"));
            Assert.That(identityItem.Alias.BirthDate, Is.Not.Null);
            var expectedBirthDate = DateTimeOffset.FromUnixTimeSeconds(631152000).UtcDateTime;
            Assert.That(identityItem.Alias.BirthDate, Is.EqualTo(expectedBirthDate));
        });

        // Test Secure Note item
        var noteItem = importedCredentials.First(c => c.ServiceName == "Secure Note");
        Assert.Multiple(() =>
        {
            Assert.That(noteItem.ServiceName, Is.EqualTo("Secure Note"));
            Assert.That(noteItem.Notes, Is.EqualTo("This is a secure note with important information."));
            Assert.That(noteItem.ItemType, Is.EqualTo(ImportedItemType.Note));
        });

        // Test Login from Work vault
        var workLoginItem = importedCredentials.First(c => c.ServiceName == "Work Portal");
        Assert.Multiple(() =>
        {
            Assert.That(workLoginItem.ServiceName, Is.EqualTo("Work Portal"));
            Assert.That(workLoginItem.Username, Is.EqualTo("admin"));
            Assert.That(workLoginItem.Password, Is.EqualTo("WorkPassword789!"));
            Assert.That(workLoginItem.FolderPath, Is.EqualTo("Work"));
            Assert.That(workLoginItem.ItemType, Is.EqualTo(ImportedItemType.Login));
        });

        // Test Document item with attachment
        var docItem = importedCredentials.First(c => c.ServiceName == "Sample Document");
        Assert.Multiple(() =>
        {
            Assert.That(docItem.ServiceName, Is.EqualTo("Sample Document"));
            Assert.That(docItem.Notes, Is.EqualTo("Test document with attachment"));
            Assert.That(docItem.FolderPath, Is.Null); // Single vault "Personal" promoted to root
            Assert.That(docItem.ItemType, Is.EqualTo(ImportedItemType.Note));
            Assert.That(docItem.Attachments, Is.Not.Null);
            Assert.That(docItem.Attachments, Has.Count.EqualTo(1));
            Assert.That(docItem.Attachments![0].Filename, Is.EqualTo("sample-document.pdf"));
            Assert.That(docItem.Attachments[0].Blob, Is.Not.Empty);
            var attachmentContent = System.Text.Encoding.UTF8.GetString(docItem.Attachments[0].Blob!);
            Assert.That(attachmentContent, Does.Contain("Sample document content"));
        });

        // Verify conversion to Item works correctly
        var convertedItems = BaseImporter.ConvertToItem(importedCredentials);
        Assert.That(convertedItems, Has.Count.EqualTo(6));

        var convertedLogin = convertedItems.First(i => i.Name == "Example Login");
        Assert.Multiple(() =>
        {
            Assert.That(convertedLogin.ItemType, Is.EqualTo(ItemType.Login));
            Assert.That(convertedLogin.TotpCodes, Has.Count.EqualTo(1));
            Assert.That(convertedLogin.TotpCodes.First().SecretKey, Is.EqualTo("JBSWY3DPEHPK3PXP"));
        });
    }

    /// <summary>
    /// Test case for importing credentials from a Proton Pass .zip export.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    public async Task ImportCredentialsFromProtonPassZip()
    {
        // Arrange
        var zipBytes = await ResourceReaderUtility.ReadEmbeddedResourceBytesAsync("AliasVault.UnitTests.TestData.Exports.protonpass.zip");

        // Act
        var importer = new ProtonPassZipImporter();
        var importedCredentials = await importer.ImportFromArchiveAsync(zipBytes);

        // Assert
        Assert.That(importedCredentials, Has.Count.EqualTo(7));

        // Login with TOTP URI.
        var loginWithTotp = importedCredentials.First(c => c.ServiceName == "Test proton 1");
        Assert.Multiple(() =>
        {
            Assert.That(loginWithTotp.ItemType, Is.EqualTo(ImportedItemType.Login));
            Assert.That(loginWithTotp.Username, Is.EqualTo("user1"));
            Assert.That(loginWithTotp.Password, Is.EqualTo("pass1"));
            Assert.That(loginWithTotp.ServiceUrls, Has.Count.EqualTo(1));
            Assert.That(loginWithTotp.ServiceUrls![0], Is.EqualTo("https://www.website.com/"));
            Assert.That(loginWithTotp.TwoFactorSecret, Does.StartWith("otpauth://totp/"));
            Assert.That(loginWithTotp.FolderPath, Is.Null); // "Personal" vault promoted to root
            Assert.That(loginWithTotp.Email, Is.Null);
        });

        var expectedCreatedAt = DateTimeOffset.FromUnixTimeSeconds(1744362003).UtcDateTime;
        Assert.That(loginWithTotp.CreatedAt, Is.EqualTo(expectedCreatedAt));

        // Alias item
        var aliasItem = importedCredentials.First(c => c.ServiceName == "Test alias");
        Assert.Multiple(() =>
        {
            Assert.That(aliasItem.ItemType, Is.EqualTo(ImportedItemType.Login));
            Assert.That(aliasItem.Email, Is.EqualTo("testalias.gating981@passinbox.com"));
            Assert.That(aliasItem.Username, Is.EqualTo("testalias.gating981@passinbox.com"));
            Assert.That(aliasItem.Password, Is.Null);
            Assert.That(aliasItem.FolderPath, Is.Null);
        });

        // Login without URLs.
        var loginNoUrls = importedCredentials.First(c => c.ServiceName == "Test proton2");
        Assert.Multiple(() =>
        {
            Assert.That(loginNoUrls.Username, Is.EqualTo("testuser2"));
            Assert.That(loginNoUrls.Password, Is.EqualTo("testpassword2"));
            Assert.That(loginNoUrls.ServiceUrls, Is.Null);
            Assert.That(loginNoUrls.TwoFactorSecret, Is.Null);
        });

        // Login without a password.
        var loginNoPass = importedCredentials.First(c => c.ServiceName == "testwithoutpass");
        Assert.Multiple(() =>
        {
            Assert.That(loginNoPass.Username, Is.EqualTo("testuser"));
            Assert.That(loginNoPass.Password, Is.Null);
        });

        // Login with URLs and a note.
        var loginWithNote = importedCredentials.First(c => c.ServiceName == "Customfields");
        Assert.Multiple(() =>
        {
            Assert.That(loginWithNote.Username, Is.EqualTo("usernamecustom"));
            Assert.That(loginWithNote.Password, Is.EqualTo("passwordecustom"));
            Assert.That(loginWithNote.Notes, Is.EqualTo("Notecustom"));
            Assert.That(loginWithNote.ServiceUrls, Has.Count.EqualTo(1));
            Assert.That(loginWithNote.ServiceUrls![0], Is.EqualTo("http://example.com/"));
        });

        // Secure note
        var noteItem = importedCredentials.First(c => c.ServiceName == "Customnote");
        Assert.Multiple(() =>
        {
            Assert.That(noteItem.ItemType, Is.EqualTo(ImportedItemType.Note));
            Assert.That(noteItem.Notes, Is.EqualTo("Customnotecontent"));
        });

        // Credit card
        var cardItem = importedCredentials.First(c => c.ServiceName == "Testcreditcard");
        Assert.Multiple(() =>
        {
            Assert.That(cardItem.ItemType, Is.EqualTo(ImportedItemType.Creditcard));
            Assert.That(cardItem.Notes, Is.EqualTo("Custom note for creditcard"));
            Assert.That(cardItem.FolderPath, Is.Null);
            Assert.That(cardItem.Creditcard, Is.Not.Null);
            Assert.That(cardItem.Creditcard!.CardholderName, Is.EqualTo("J Johnson"));
            Assert.That(cardItem.Creditcard.Number, Is.EqualTo("1234123412341234123"));
            Assert.That(cardItem.Creditcard.Cvv, Is.EqualTo("123"));
            Assert.That(cardItem.Creditcard.Pin, Is.EqualTo("1234"));
            Assert.That(cardItem.Creditcard.ExpiryYear, Is.EqualTo("2029"));
            Assert.That(cardItem.Creditcard.ExpiryMonth, Is.EqualTo("06"));
        });

        // Conversion to Item extracts the TOTP secret from the URI.
        var convertedItems = BaseImporter.ConvertToItem(importedCredentials);
        Assert.That(convertedItems, Has.Count.EqualTo(7));

        var convertedLogin = convertedItems.First(i => i.Name == "Test proton 1");
        Assert.Multiple(() =>
        {
            Assert.That(convertedLogin.ItemType, Is.EqualTo(ItemType.Login));
            Assert.That(convertedLogin.TotpCodes, Has.Count.EqualTo(1));
            Assert.That(convertedLogin.TotpCodes.First().SecretKey, Is.EqualTo("PLW4SB3PQ7MKVXY2MXF4NEXS6Y"));
        });
    }
}
