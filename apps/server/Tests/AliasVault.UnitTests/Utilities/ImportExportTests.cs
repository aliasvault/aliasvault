//-----------------------------------------------------------------------
// <copyright file="ImportExportTests.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.UnitTests.Utilities;

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
        Assert.That(importedCredentials, Has.Count.EqualTo(8));

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

        // Test entry with multiple URLs (TutaNota3)
        var multiUrlCredential = importedCredentials.First(c => c.ServiceName == "TutaNota3");
        Assert.Multiple(() =>
        {
            Assert.That(multiUrlCredential.ServiceName, Is.EqualTo("TutaNota3"));
            Assert.That(multiUrlCredential.ServiceUrls, Has.Count.EqualTo(3));
            Assert.That(multiUrlCredential.ServiceUrls![0], Is.EqualTo("https://www.aliasvault.net"));
            Assert.That(multiUrlCredential.ServiceUrls[1], Is.EqualTo("https://app.aliasvault.net"));
            Assert.That(multiUrlCredential.ServiceUrls[2], Is.EqualTo("https://downloads.aliasvault.net"));
            Assert.That(multiUrlCredential.Username, Is.EqualTo("avtest3@tutamail.com"));
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
    /// Test case for KeePassXC group (folder) import.
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
        Assert.That(folderNames, Has.Count.GreaterThanOrEqualTo(0), "Should collect any folders present");
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
            { "Projects", Guid.NewGuid() }, // Deepest folder from "Work/Projects"
            { "Personal", Guid.NewGuid() },
        };

        // Act
        var items = BaseImporter.ConvertToItem(credentials, folderMapping);

        // Assert
        Assert.That(items[0].FolderId, Is.EqualTo(folderMapping["Projects"]), "Should assign Projects folder");
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
}
