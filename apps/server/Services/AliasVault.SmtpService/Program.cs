//-----------------------------------------------------------------------
// <copyright file="Program.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

using System.Globalization;
using System.Reflection;
using System.Security.Cryptography.X509Certificates;
using AliasServerDb;
using AliasServerDb.Configuration;
using AliasVault.Logging;
using AliasVault.SmtpService;
using AliasVault.SmtpService.Handlers;
using AliasVault.SmtpService.Workers;
using AliasVault.WorkerStatus.ServiceExtensions;
using Microsoft.EntityFrameworkCore;
using SmtpServer;
using SmtpServer.Storage;

var builder = Host.CreateApplicationBuilder(args);

// Force invariant culture to prevent regional date formatting issues
// (e.g., times should be formatted as "09:03:09" instead of alternate region formats like "09.03.09").
CultureInfo.DefaultThreadCurrentCulture = CultureInfo.InvariantCulture;
CultureInfo.DefaultThreadCurrentUICulture = CultureInfo.InvariantCulture;

builder.Configuration.AddJsonFile("appsettings.json", optional: false, reloadOnChange: true);
builder.Configuration.AddJsonFile($"appsettings.{builder.Environment.EnvironmentName}.json", optional: true, reloadOnChange: true);
builder.Services.ConfigureLogging(builder.Configuration, Assembly.GetExecutingAssembly().GetName().Name!, "../../../logs");

// Create global config object, get values from environment variables.
Config config = new Config();
var emailDomains = Environment.GetEnvironmentVariable("PRIVATE_EMAIL_DOMAINS") ?? string.Empty;
config.AllowedToDomains = emailDomains.Split(',').ToList();

var tlsEnabled = Environment.GetEnvironmentVariable("SMTP_TLS_ENABLED") ?? "false";
config.SmtpTlsEnabled = tlsEnabled;

var certPath = Environment.GetEnvironmentVariable("SMTP_CERTIFICATES_PATH") ?? "/certificates/smtp";
config.SmtpCertificatesPath = certPath;

// Check if TLS is requested but certificates are not available, if so, fallback to non-TLS mode.
var tlsAvailable = false;
X509Certificate2? loadedCertificate = null;
string? loadedCertificateFile = null;
if (config.SmtpTlsEnabled == "true")
{
    var certResult = TryLoadCertificate(config.SmtpCertificatesPath);
    if (certResult.Success)
    {
        tlsAvailable = true;
        loadedCertificate = certResult.Certificate;
        loadedCertificateFile = certResult.CertificateFile;
    }
    else
    {
        // TLS was requested but certificate loading failed: will log warning after host is built.
        config.TlsCertificateError = certResult.ErrorMessage;
    }
}

builder.Services.AddSingleton(config);

builder.Services.AddAliasVaultDatabaseConfiguration(builder.Configuration);
builder.Services.AddTransient<IMessageStore, DatabaseMessageStore>();
builder.Services.AddSingleton(
    provider =>
    {
        // Use SmtpServerWorker logger so logs appear in the database (it's in the allowed sources list).
        var logger = provider.GetRequiredService<ILogger<SmtpServerWorker>>();
        var options = new SmtpServerOptionsBuilder()
            .ServerName("aliasvault");

        if (tlsAvailable && loadedCertificate != null)
        {
            // TLS enabled with valid certificate.
            logger.LogInformation(
                "SMTP TLS enabled successfully. Certificate: {CertFile}, Subject: {Subject}, Expires: {Expiry}",
                loadedCertificateFile,
                loadedCertificate.Subject,
                loadedCertificate.NotAfter.ToString("yyyy-MM-dd"));
            options.Endpoint(serverBuilder =>
                    serverBuilder
                        .Port(25, false)
                        .AllowUnsecureAuthentication()
                        .Certificate(loadedCertificate)
                        .SupportedSslProtocols(System.Security.Authentication.SslProtocols.Tls12))
                .Endpoint(serverBuilder =>
                    serverBuilder
                        .Port(587, false)
                        .AllowUnsecureAuthentication()
                        .Certificate(loadedCertificate)
                        .SupportedSslProtocols(System.Security.Authentication.SslProtocols.Tls12));
        }
        else
        {
            // No TLS: either not requested or certificate not available.
            if (config.SmtpTlsEnabled == "true" && !string.IsNullOrEmpty(config.TlsCertificateError))
            {
                // TLS was requested but failed: log warning.
                logger.LogWarning(
                    "SMTP TLS is enabled but certificate could not be loaded: {Error}. " +
                    "Falling back to non-TLS mode. To fix: place valid .pem certificate file(s) in {CertPath}",
                    config.TlsCertificateError,
                    config.SmtpCertificatesPath);
            }

            options.Endpoint(serverBuilder =>
                    serverBuilder
                        .Port(25, false))
                .Endpoint(serverBuilder =>
                    serverBuilder
                        .Port(587, false));
        }

        return new SmtpServer.SmtpServer(options.Build(), provider.GetRequiredService<IServiceProvider>());
    });

// Attempts to load a TLS certificate from the specified directory.
static (bool Success, X509Certificate2? Certificate, string? CertificateFile, string? ErrorMessage) TryLoadCertificate(string certificatesDirectory)
{
    try
    {
        // Check if directory exists.
        if (!Directory.Exists(certificatesDirectory))
        {
            return (false, null, null, $"Certificate directory does not exist: {certificatesDirectory}");
        }

        // Get all PEM files in the directory (expecting a single file with all domains as SANs).
        string[] pemFiles = Directory.GetFiles(certificatesDirectory, "*.pem");

        if (pemFiles.Length == 0)
        {
            return (false, null, null, $"No .pem certificate files found in folder: '{certificatesDirectory}'");
        }

        // Use the first PEM file found (alphabetically). Only one certificate file should be present.
        // For multiple mail domains, use a single certificate with Subject Alternative Names (SANs).
        string firstPemFile = pemFiles[0];
        string fileName = Path.GetFileName(firstPemFile);

        // Create an X509Certificate2 object from the PEM file.
        var cert = X509Certificate2.CreateFromPemFile(firstPemFile);

        // Convert the X509Certificate2 object to a PFX file then immediately load it again.
        var certBytes = cert.Export(X509ContentType.Pfx, "password");
        var loadedCert = X509CertificateLoader.LoadPkcs12(certBytes, "password", X509KeyStorageFlags.DefaultKeySet);

        return (true, loadedCert, fileName, null);
    }
    catch (Exception ex)
    {
        return (false, null, null, $"Failed to load certificate: {ex.Message}");
    }
}

// -----------------------------------------------------------------------
// Register hosted services via Status library wrapper in order to monitor and control (start/stop) them via the database.
// -----------------------------------------------------------------------
builder.Services.AddStatusHostedService<SmtpServerWorker, AliasServerDbContext>(Assembly.GetExecutingAssembly().GetName().Name!);

var host = builder.Build();

using (var scope = host.Services.CreateScope())
{
    var container = scope.ServiceProvider;
    var factory = container.GetRequiredService<IAliasServerDbContextFactory>();
    var logger = container.GetRequiredService<ILogger<Program>>();
    await using var context = await factory.CreateDbContextAsync();

    // Wait for migrations to be applied (API project runs them centrally)
    await context.WaitForDatabaseReadyAsync(logger);
}

await host.RunAsync();
