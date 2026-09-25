//-----------------------------------------------------------------------
// <copyright file="EmailEncryptionTests.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.UnitTests.Utilities;

using System.IO.Compression;
using System.Text;
using AliasServerDb;
using AliasVault.Cryptography.Server;
using AliasVault.Shared.Models.Enums;

/// <summary>
/// Tests for the EmailEncryption class, covering the source-only storage format (gzipped MessageSourceBytes)
/// as well as legacy rows that still carry the text MessageSource column.
/// </summary>
public class EmailEncryptionTests
{
    /// <summary>
    /// Roundtrip test for the source-only storage format: the gzipped source bytes are encrypted via the byte
    /// path and after decryption are still gzip-compressed (starting with the gzip magic bytes 0x1f 0x8b).
    /// </summary>
    [Test]
    public void EncryptDecryptEmailSourceBytesRoundtrip()
    {
        const string rawMime = "From: sender@example.com\r\nTo: recipient@example.tld\r\nSubject: Test\r\n\r\nHello body";
        var gzippedSource = Gzip(rawMime);
        var email = CreateTestEmail();
        email.MessageSourceBytes = gzippedSource;
        email.AttachmentCount = 1;

        var deliveryKey = new VaultManifestDeliveryKey { Id = Guid.NewGuid(), VaultManifestId = Guid.NewGuid(), Algorithm = VaultKeyAlgorithm.RsaOaepSha256, PublicKey = RsaEncryptionTests.PublicKey, IsPrimary = true };
        var encrypted = EmailEncryption.EncryptEmail(email, [deliveryKey]);
        Assert.Multiple(() =>
        {
            Assert.That(encrypted.MessageSourceBytes, Is.Not.EqualTo(gzippedSource), "MessageSourceBytes should be encrypted at rest.");
            Assert.That(encrypted.MessageSource, Is.Null, "The legacy text source column should remain unset for source-only emails.");
            Assert.That(encrypted.DecryptionKeys, Has.Count.EqualTo(1));
            Assert.That(encrypted.DecryptionKeys[0].VaultManifestDeliveryKeyId, Is.EqualTo(deliveryKey.Id));
        });

        var decrypted = EmailEncryption.DecryptEmail(encrypted, RsaEncryptionTests.PrivateKey);
        Assert.Multiple(() =>
        {
            Assert.That(decrypted.MessageSourceBytes![0], Is.EqualTo(0x1f), "Decrypted source should still be gzip-compressed (gzip magic byte 1).");
            Assert.That(decrypted.MessageSourceBytes![1], Is.EqualTo(0x8b), "Decrypted source should still be gzip-compressed (gzip magic byte 2).");
            Assert.That(decrypted.MessageSourceBytes, Is.EqualTo(gzippedSource));
            Assert.That(decrypted.Subject, Is.EqualTo("Test subject"));
            Assert.That(decrypted.MessagePreview, Is.EqualTo("Test preview"));
        });

        // Gunzip the decrypted bytes to get back the raw MIME source.
        var decompressedSource = Encoding.UTF8.GetString(Gunzip(decrypted.MessageSourceBytes!));
        Assert.That(decompressedSource, Is.EqualTo(rawMime));
    }

    /// <summary>
    /// Roundtrip test for legacy-shaped emails: the text MessageSource column and parsed bodies are still
    /// encrypted and decrypted, and the absent MessageSourceBytes column stays null throughout.
    /// </summary>
    [Test]
    public void EncryptDecryptLegacyEmailTextSourceRoundtrip()
    {
        var email = CreateTestEmail();
        email.MessageSource = "Legacy raw source";
        email.MessagePlain = "Legacy plain body";
        email.MessageHtml = "<p>Legacy html body</p>";

        var deliveryKey = new VaultManifestDeliveryKey { Id = Guid.NewGuid(), VaultManifestId = Guid.NewGuid(), Algorithm = VaultKeyAlgorithm.RsaOaepSha256, PublicKey = RsaEncryptionTests.PublicKey, IsPrimary = true };
        var encrypted = EmailEncryption.EncryptEmail(email, [deliveryKey]);
        Assert.Multiple(() =>
        {
            Assert.That(encrypted.MessageSource, Is.Not.EqualTo("Legacy raw source"), "MessageSource should be encrypted at rest.");
            Assert.That(encrypted.MessageSourceBytes, Is.Null, "MessageSourceBytes should stay null for legacy-shaped emails.");
        });

        var decrypted = EmailEncryption.DecryptEmail(encrypted, RsaEncryptionTests.PrivateKey);
        Assert.Multiple(() =>
        {
            Assert.That(decrypted.MessageSource, Is.EqualTo("Legacy raw source"));
            Assert.That(decrypted.MessagePlain, Is.EqualTo("Legacy plain body"));
            Assert.That(decrypted.MessageHtml, Is.EqualTo("<p>Legacy html body</p>"));
            Assert.That(decrypted.MessageSourceBytes, Is.Null, "MessageSourceBytes should stay null for legacy-shaped emails.");
        });
    }

    /// <summary>
    /// Creates a minimal email with all required fields set and every nullable message column left null.
    /// </summary>
    /// <returns>Email test object.</returns>
    private static Email CreateTestEmail()
    {
        return new Email
        {
            Subject = "Test subject",
            From = "\"Test Sender\" <sender@example.com>",
            FromLocal = "sender",
            FromDomain = "example.com",
            To = "recipient@example.tld",
            ToLocal = "recipient",
            ToDomain = "example.tld",
            MessagePreview = "Test preview",
            Date = DateTime.UtcNow,
            DateSystem = DateTime.UtcNow,
        };
    }

    /// <summary>
    /// Gzip-compresses a string, mirroring how the SMTP ingest stores the raw message source.
    /// </summary>
    /// <param name="content">The content to compress.</param>
    /// <returns>The gzip-compressed bytes.</returns>
    private static byte[] Gzip(string content)
    {
        using var output = new MemoryStream();
        using (var gzip = new GZipStream(output, CompressionLevel.Optimal, leaveOpen: true))
        {
            gzip.Write(Encoding.UTF8.GetBytes(content));
        }

        return output.ToArray();
    }

    /// <summary>
    /// Decompresses gzip-compressed bytes.
    /// </summary>
    /// <param name="gzippedBytes">The gzip-compressed bytes.</param>
    /// <returns>The decompressed bytes.</returns>
    private static byte[] Gunzip(byte[] gzippedBytes)
    {
        using var input = new MemoryStream(gzippedBytes);
        using var gzip = new GZipStream(input, CompressionMode.Decompress);
        using var output = new MemoryStream();
        gzip.CopyTo(output);
        return output.ToArray();
    }
}
