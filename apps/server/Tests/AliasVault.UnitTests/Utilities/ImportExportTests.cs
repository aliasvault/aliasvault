//-----------------------------------------------------------------------
// <copyright file="ImportExportTests.cs" company="lanedirt">
// Copyright (c) lanedirt. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.UnitTests.Utilities;

using AliasClientDb;
using AliasVault.ImportExport;
using AliasVault.ImportExport.Importers;
using AliasVault.UnitTests.Common;

/// <summary>
/// Tests for the AliasVault.ImportExport class.
/// </summary>
public class ImportExportTests
{
    /// <summary>
    /// Test case for importing credentials from CSV and ensuring all values are present.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    public async Task ImportCredentialsFromCsv()
    {
        // Arrange
        var credential = new Credential
        {
            Id = new Guid("00000000-0000-0000-0000-000000000001"),
            Username = "testuser",
            Notes = "Test notes",
            CreatedAt = DateTime.Now,
            UpdatedAt = DateTime.Now,
            AliasId = new Guid("00000000-0000-0000-0000-000000000002"),
            Alias = new Alias
            {
                Id = new Guid("00000000-0000-0000-0000-000000000002"),
                Gender = "Male",
                FirstName = "John",
                LastName = "Doe",
                NickName = "JD",
                BirthDate = new DateTime(1990, 1, 1, 0, 0, 0, DateTimeKind.Utc),
                Email = "johndoe",
                CreatedAt = DateTime.Now,
                UpdatedAt = DateTime.Now,
            },
            ServiceId = new Guid("00000000-0000-0000-0000-000000000003"),
            Service = new Service
            {
                Id = new Guid("00000000-0000-0000-0000-000000000003"),
                Name = "Test Service",
                Url = "https://testservice.com",
            },
            Passwords =
            [
                new Password
                {
                    Value = "password123",
                    CreatedAt = DateTime.Now,
                    UpdatedAt = DateTime.Now,
                },
            ],
        };

        var csvContent = CredentialCsvService.ExportCredentialsToCsv([credential]);
        var csvString = System.Text.Encoding.Default.GetString(csvContent);

        // Act
        var importedCredentials = await CredentialCsvService.ImportCredentialsFromCsv(csvString);

        // Assert
        Assert.That(importedCredentials, Has.Count.EqualTo(1));

        var importedCredential = importedCredentials[0];

        Assert.Multiple(() =>
        {
            Assert.That(importedCredential.ServiceName, Is.EqualTo(credential.Service.Name));
            Assert.That(importedCredential.ServiceUrl, Is.EqualTo(credential.Service.Url));
            Assert.That(importedCredential.Username, Is.EqualTo(credential.Username));
            Assert.That(importedCredential.Notes, Is.EqualTo(credential.Notes));
            Assert.That(importedCredential.CreatedAt?.Date, Is.EqualTo(credential.CreatedAt.Date));
            Assert.That(importedCredential.UpdatedAt?.Date, Is.EqualTo(credential.UpdatedAt.Date));
            Assert.That(importedCredential.Alias!.Gender, Is.EqualTo(credential.Alias!.Gender));
            Assert.That(importedCredential.Alias!.FirstName, Is.EqualTo(credential.Alias!.FirstName));
            Assert.That(importedCredential.Alias!.LastName, Is.EqualTo(credential.Alias!.LastName));
            Assert.That(importedCredential.Alias!.NickName, Is.EqualTo(credential.Alias!.NickName));
            Assert.That(importedCredential.Alias!.BirthDate, Is.EqualTo(credential.Alias!.BirthDate));
            Assert.That(importedCredential.Alias!.CreatedAt?.Date, Is.EqualTo(credential.Alias!.CreatedAt.Date));
            Assert.That(importedCredential.Alias!.UpdatedAt?.Date, Is.EqualTo(credential.Alias!.UpdatedAt.Date));
            Assert.That(importedCredential.Password, Is.EqualTo(credential.Passwords.First().Value));
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
        Assert.That(importedCredentials, Has.Count.EqualTo(5));

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
            Assert.That(aliasVaultCredential.ServiceUrl, Is.EqualTo("https://www.aliasvault.net"));
            Assert.That(aliasVaultCredential.Username, Is.EqualTo("root"));
            Assert.That(aliasVaultCredential.Password, Is.EqualTo("toor"));
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
            Assert.That(sampleCredential.ServiceUrl, Is.EqualTo("https://strongboxsafe.com"));
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
            Assert.That(onePasswordAccount.ServiceUrl, Is.EqualTo("https://my.1password.com"));
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
            Assert.That(exampleCredential.ServiceUrl, Is.EqualTo("https://example.com/"));
            Assert.That(exampleCredential.Username, Is.EqualTo("usernamegoogle"));
            Assert.That(exampleCredential.Password, Is.EqualTo("passwordgoogle"));
            Assert.That(exampleCredential.Notes, Is.EqualTo("Note for example password from Google"));
        });

        var facebookCredential = importedCredentials.First(c => c.ServiceName == "facebook.com");
        Assert.Multiple(() =>
        {
            Assert.That(facebookCredential.ServiceName, Is.EqualTo("facebook.com"));
            Assert.That(facebookCredential.ServiceUrl, Is.EqualTo("https://facebook.com/"));
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
            Assert.That(exampleCredential.ServiceUrl, Is.EqualTo("https://example.com"));
            Assert.That(exampleCredential.Username, Is.EqualTo("username-example"));
            Assert.That(exampleCredential.Password, Is.EqualTo("examplepassword"));
        });

        var youtubeCredential = importedCredentials.First(c => c.ServiceName == "youtube.com");
        Assert.Multiple(() =>
        {
            Assert.That(youtubeCredential.ServiceName, Is.EqualTo("youtube.com"));
            Assert.That(youtubeCredential.ServiceUrl, Is.EqualTo("https://youtube.com"));
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
            Assert.That(sampleEntry.ServiceUrl, Is.EqualTo("https://keepass.info/"));
            Assert.That(sampleEntry.Username, Is.EqualTo("User Name"));
            Assert.That(sampleEntry.Password, Is.EqualTo("Password"));
            Assert.That(sampleEntry.Notes, Is.EqualTo("Notes"));
        });

        var sampleEntry2 = importedCredentials.First(c => c.ServiceName == "Sample Entry #2");
        Assert.Multiple(() =>
        {
            Assert.That(sampleEntry2.ServiceName, Is.EqualTo("Sample Entry #2"));
            Assert.That(sampleEntry2.ServiceUrl, Is.EqualTo("https://keepass.info/help/kb/testform.html"));
            Assert.That(sampleEntry2.Username, Is.EqualTo("Michael321"));
            Assert.That(sampleEntry2.Password, Is.EqualTo("12345"));
            Assert.That(sampleEntry2.Notes, Is.Empty);
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
            Assert.That(sampleEntry.ServiceUrl, Is.EqualTo("https://keepass.info/"));
            Assert.That(sampleEntry.Username, Is.EqualTo("User Name"));
            Assert.That(sampleEntry.Password, Is.EqualTo("Password"));
            Assert.That(sampleEntry.Notes, Is.EqualTo("Notes"));
            Assert.That(sampleEntry.TwoFactorSecret, Is.Empty);
        });

        var sampleEntry2 = importedCredentials.First(c => c.ServiceName == "Sample Entry #2");
        Assert.Multiple(() =>
        {
            Assert.That(sampleEntry2.ServiceName, Is.EqualTo("Sample Entry #2"));
            Assert.That(sampleEntry2.ServiceUrl, Is.EqualTo("https://keepass.info/help/kb/testform.html"));
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
            Assert.That(testProton1Credential.ServiceUrl, Is.EqualTo("https://www.website.com/"));
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
            Assert.That(testCredential.ServiceUrl, Is.EqualTo("https://Test"));
            Assert.That(testCredential.Username, Is.EqualTo("Test username"));
            Assert.That(testCredential.Password, Is.EqualTo("password123"));
            Assert.That(testCredential.Notes, Is.Null);
        });

        var googleCredential = importedCredentials.First(c => c.ServiceName == "Google");
        Assert.Multiple(() =>
        {
            Assert.That(googleCredential.ServiceName, Is.EqualTo("Google"));
            Assert.That(googleCredential.ServiceUrl, Is.EqualTo("https://www.google.com"));
            Assert.That(googleCredential.Username, Is.EqualTo("googleuser"));
            Assert.That(googleCredential.Password, Is.EqualTo("googlepassword"));
            Assert.That(googleCredential.Notes, Is.Null);
        });

        var localCredential = importedCredentials.First(c => c.ServiceName == "Local");
        Assert.Multiple(() =>
        {
            Assert.That(localCredential.ServiceName, Is.EqualTo("Local"));
            Assert.That(localCredential.ServiceUrl, Is.EqualTo("https://www.testwebsite.local"));
            Assert.That(localCredential.Username, Is.EqualTo("testusername"));
            Assert.That(localCredential.Password, Is.EqualTo("testpassword"));
            Assert.That(localCredential.Notes, Is.EqualTo("testnote\nAlternative username 1: testusernamealternative"));
        });
    }
}
