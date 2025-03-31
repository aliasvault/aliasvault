//-----------------------------------------------------------------------
// <copyright file="ImportExportTests.cs" company="lanedirt">
// Copyright (c) lanedirt. All rights reserved.
// Licensed under the MIT license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Tests.Utilities;

using AliasClientDb;
using AliasVault.ImportExport;

/// <summary>
/// Tests for the AliasVault.ImportExport class.
/// </summary>
public class ImportExportTests
{
    /// <summary>
    /// Test case for importing credentials from CSV and ensuring all values are present.
    /// </summary>
    [Test]
    public void ImportCredentialsFromCsv()
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
        var importedCredentials = CredentialCsvService.ImportCredentialsFromCsv(csvString);

        // Assert
        Assert.That(importedCredentials, Has.Count.EqualTo(1));

        var importedCredential = importedCredentials[0];

        Assert.Multiple(() =>
        {
            Assert.That(importedCredential.Id, Is.EqualTo(credential.Id));
            Assert.That(importedCredential.Username, Is.EqualTo(credential.Username));
            Assert.That(importedCredential.Notes, Is.EqualTo(credential.Notes));
            Assert.That(importedCredential.CreatedAt.ToString("yyyy-MM-dd"), Is.EqualTo(credential.CreatedAt.ToString("yyyy-MM-dd")));
            Assert.That(importedCredential.UpdatedAt.ToString("yyyy-MM-dd"), Is.EqualTo(credential.UpdatedAt.ToString("yyyy-MM-dd")));
            Assert.That(importedCredential.AliasId, Is.EqualTo(credential.AliasId));
            Assert.That(importedCredential.Alias.Id, Is.EqualTo(credential.Alias.Id));
            Assert.That(importedCredential.Alias.Gender, Is.EqualTo(credential.Alias.Gender));
            Assert.That(importedCredential.Alias.FirstName, Is.EqualTo(credential.Alias.FirstName));
            Assert.That(importedCredential.Alias.LastName, Is.EqualTo(credential.Alias.LastName));
            Assert.That(importedCredential.Alias.NickName, Is.EqualTo(credential.Alias.NickName));
            Assert.That(importedCredential.Alias.BirthDate, Is.EqualTo(credential.Alias.BirthDate));
            Assert.That(importedCredential.Alias.Email, Is.EqualTo(credential.Alias.Email));
            Assert.That(importedCredential.Alias.CreatedAt.ToString("yyyy-MM-dd"), Is.EqualTo(credential.Alias.CreatedAt.ToString("yyyy-MM-dd")));
            Assert.That(importedCredential.Alias.UpdatedAt.ToString("yyyy-MM-dd"), Is.EqualTo(credential.Alias.UpdatedAt.ToString("yyyy-MM-dd")));
            Assert.That(importedCredential.ServiceId, Is.EqualTo(credential.ServiceId));
            Assert.That(importedCredential.Service.Id, Is.EqualTo(credential.Service.Id));
            Assert.That(importedCredential.Service.Name, Is.EqualTo(credential.Service.Name));
            Assert.That(importedCredential.Service.Url, Is.EqualTo(credential.Service.Url));
            Assert.That(importedCredential.Passwords, Has.Count.EqualTo(1));

            var importedPassword = importedCredential.Passwords.First();
            var originalPassword = credential.Passwords.First();

            Assert.That(importedPassword.Value, Is.EqualTo(originalPassword.Value));
            Assert.That(importedPassword.CreatedAt.ToString("yyyy-MM-dd"), Is.EqualTo(originalPassword.CreatedAt.ToString("yyyy-MM-dd")));
            Assert.That(importedPassword.UpdatedAt.ToString("yyyy-MM-dd"), Is.EqualTo(originalPassword.UpdatedAt.ToString("yyyy-MM-dd")));
        });
    }
}
