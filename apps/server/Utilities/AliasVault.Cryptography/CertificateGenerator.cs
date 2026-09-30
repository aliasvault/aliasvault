//-----------------------------------------------------------------------
// <copyright file="CertificateGenerator.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Cryptography;

using System;
using System.IO;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;

/// <summary>
/// Helper methods to generate certificates.
/// </summary>
public static class CertificateGenerator
{
    /// <summary>
    /// Generate a self-signed Pfx certificate.
    /// </summary>
    /// <param name="subjectName">Subject name.</param>
    /// <param name="password">Password for certificate.</param>
    /// <param name="validityYears">Validity in years.</param>
    /// <returns>X509Certificate2 instance.</returns>
    public static X509Certificate2 GeneratePfx(string subjectName, string password, int validityYears = 100)
    {
        using (RSA rsa = RSA.Create(4096))
        {
            var request = new CertificateRequest(
                $"CN={subjectName}",
                rsa,
                HashAlgorithmName.SHA256,
                RSASignaturePadding.Pkcs1);

            request.CertificateExtensions.Add(
                new X509KeyUsageExtension(
                    X509KeyUsageFlags.DataEncipherment | X509KeyUsageFlags.KeyEncipherment | X509KeyUsageFlags.DigitalSignature,
                    false));

            request.CertificateExtensions.Add(
                new X509EnhancedKeyUsageExtension(
                    new OidCollection { new Oid("1.3.6.1.5.5.7.3.1") }, false));

            var certificate = request.CreateSelfSigned(
                DateTimeOffset.UtcNow.AddDays(-1),
                DateTimeOffset.UtcNow.AddYears(validityYears));

            return X509CertificateLoader.LoadPkcs12(certificate.Export(X509ContentType.Pfx, password), password, X509KeyStorageFlags.Exportable);
        }
    }

    /// <summary>
    /// Save the certificate to a file.
    /// </summary>
    /// <param name="cert">The certificate.</param>
    /// <param name="password">Password of certificate.</param>
    /// <param name="filePath">Path to save certificate to.</param>
    public static void SaveCertificateToFile(X509Certificate2 cert, string password, string filePath)
    {
        File.WriteAllBytes(filePath, cert.Export(X509ContentType.Pfx, password));
    }
}
