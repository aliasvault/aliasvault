//-----------------------------------------------------------------------
// <copyright file="SecretReader.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Server.Utilities;

using System;
using System.Globalization;
using System.IO;

/// <summary>
/// Utility class for reading secrets from environment variables or container secret files.
/// </summary>
public static class SecretReader
{
    /// <summary>
    /// Determines if the application is running in a container.
    /// </summary>
    /// <returns>True if running in a container, false otherwise.</returns>
    public static bool IsRunningInContainer()
    {
        return Environment.GetEnvironmentVariable("DOTNET_RUNNING_IN_CONTAINER") == "true";
    }

    /// <summary>
    /// Gets the container secrets directory, defaults to /secrets but optionally configurable via
    /// the SECRETS_PATH environment variable.
    /// </summary>
    /// <returns>The secrets directory path.</returns>
    public static string GetSecretsPath()
    {
        var secretsPath = Environment.GetEnvironmentVariable("SECRETS_PATH");
        return string.IsNullOrEmpty(secretsPath) ? "/secrets" : secretsPath;
    }

    /// <summary>
    /// Gets the JWT key from either the container secrets file or environment variable.
    /// </summary>
    /// <returns>The JWT key.</returns>
    /// <exception cref="KeyNotFoundException">Thrown when the JWT key cannot be found or is invalid.</exception>
    public static string GetJwtKey()
    {
        if (IsRunningInContainer())
        {
            return ReadSecretFromFile(Path.Combine(GetSecretsPath(), "jwt_key"), "JWT key");
        }

        var jwtKey = Environment.GetEnvironmentVariable("JWT_KEY");
        if (string.IsNullOrEmpty(jwtKey))
        {
            throw new KeyNotFoundException("JWT_KEY environment variable is not set.");
        }

        return jwtKey;
    }

    /// <summary>
    /// Gets the admin password hash and generation timestamp.
    /// </summary>
    /// <returns>A tuple containing the password hash and the timestamp when it was generated.</returns>
    /// <exception cref="KeyNotFoundException">Thrown when the admin password hash cannot be found.</exception>
    /// <exception cref="InvalidOperationException">Thrown when the admin password hash file has an invalid format.</exception>
    public static (string PasswordHash, DateTime GeneratedAt) GetAdminPasswordHash()
    {
        if (IsRunningInContainer())
        {
            var secretsFilePath = Path.Combine(GetSecretsPath(), "admin_password_hash");
            if (!File.Exists(secretsFilePath))
            {
                throw new KeyNotFoundException($"Admin password hash file not found at {secretsFilePath}. Container initialization may have failed.");
            }

            var secretContent = File.ReadAllText(secretsFilePath).Trim();
            if (string.IsNullOrEmpty(secretContent))
            {
                throw new KeyNotFoundException($"Admin password hash file at {secretsFilePath} is empty.");
            }

            // Parse hash and timestamp separated by |
            var parts = secretContent.Split('|');
            if (parts.Length != 2)
            {
                throw new InvalidOperationException($"Invalid format in {secretsFilePath}. Expected format: hash|timestamp");
            }

            var passwordHash = parts[0];
            if (!DateTime.TryParse(parts[1], CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var generatedAt))
            {
                throw new InvalidOperationException($"Invalid timestamp format in {secretsFilePath}: {parts[1]}");
            }

            return (passwordHash, generatedAt);
        }
        else
        {
            // Not in container - use environment variables
            var passwordHash = Environment.GetEnvironmentVariable("ADMIN_PASSWORD_HASH")
                ?? throw new KeyNotFoundException("ADMIN_PASSWORD_HASH environment variable is not set.");

            var generatedAtStr = Environment.GetEnvironmentVariable("ADMIN_PASSWORD_GENERATED")
                ?? throw new KeyNotFoundException("ADMIN_PASSWORD_GENERATED environment variable is not set.");

            var generatedAt = DateTime.Parse(generatedAtStr, CultureInfo.InvariantCulture);
            return (passwordHash, generatedAt);
        }
    }

    /// <summary>
    /// Gets the data protection certificate password.
    /// </summary>
    /// <returns>The data protection certificate password.</returns>
    /// <exception cref="KeyNotFoundException">Thrown when the certificate password cannot be found.</exception>
    public static string GetDataProtectionCertPassword()
    {
        if (IsRunningInContainer())
        {
            return ReadSecretFromFile(Path.Combine(GetSecretsPath(), "data_protection_cert_pass"), "Certificate password");
        }

        return Environment.GetEnvironmentVariable("DATA_PROTECTION_CERT_PASS")
            ?? throw new KeyNotFoundException("DATA_PROTECTION_CERT_PASS is not set in configuration or environment variables.");
    }

    /// <summary>
    /// Reads a secret from a file in the container secrets directory.
    /// </summary>
    /// <param name="filePath">The path to the secret file.</param>
    /// <param name="secretName">The name of the secret for error messages.</param>
    /// <returns>The secret value.</returns>
    /// <exception cref="KeyNotFoundException">Thrown when the secret file cannot be found or is invalid.</exception>
    private static string ReadSecretFromFile(string filePath, string secretName)
    {
        if (!File.Exists(filePath))
        {
            throw new KeyNotFoundException($"{secretName} file not found at {filePath}. Container initialization may have failed.");
        }

        var secretValue = File.ReadAllText(filePath).Trim();
        if (string.IsNullOrEmpty(secretValue))
        {
            throw new KeyNotFoundException($"{secretName} file at {filePath} is empty.");
        }

        return secretValue;
    }
}
