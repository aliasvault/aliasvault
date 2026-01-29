//-----------------------------------------------------------------------
// <copyright file="Config.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------
namespace AliasVault.Client;

/// <summary>
/// Configuration class for the Client project with values loaded from appsettings.json.
/// </summary>
public class Config
{
    /// <summary>
    /// Gets or sets the API URL for the AliasVault server.
    /// </summary>
    public string ApiUrl { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the list of private email domains that the AliasVault server is listening for.
    /// Email addresses that client vault users use will be registered at the server
    /// to get exclusive access to the email address.
    /// </summary>
    public List<string> PrivateEmailDomains { get; set; } = [];

    /// <summary>
    /// Gets or sets the list of private email domains that should be hidden from UI components.
    /// These domains still function as private email domains but are not shown in domain selection dropdowns.
    /// </summary>
    public List<string> HiddenPrivateEmailDomains { get; set; } = [];

    /// <summary>
    /// Gets or sets the list of public email domains that are allowed to be used by the client vault users.
    /// </summary>
    public List<string> PublicEmailDomains { get; set; } =
    [
        "spamok.com",
        "solarflarecorp.com",
        "spamok.nl",
        "3060.nl",
        "landmail.nl",
        "asdasd.nl",
        "spamok.de",
        "spamok.com.ua",
        "spamok.es",
        "spamok.fr",
    ];

    /// <summary>
    /// Gets or sets a value indicating whether to use a debug encryption key.
    /// This should only be set to true in development environments.
    /// </summary>
    public bool UseDebugEncryptionKey { get; set; }

    /// <summary>
    /// Gets or sets the type of cryptography to use for password hashing.
    /// Currently supports "Argon2Id".
    /// </summary>
    public string? CryptographyOverrideType { get; set; }

    /// <summary>
    /// Gets or sets the JSON string containing cryptography settings.
    /// For Argon2Id, this includes DegreeOfParallelism, MemorySize, and Iterations.
    /// </summary>
    public string? CryptographyOverrideSettings { get; set; }

    /// <summary>
    /// Gets or sets the support email address that users can contact for password recovery.
    /// </summary>
    public string? SupportEmail { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether public registration is enabled.
    /// </summary>
    public bool PublicRegistrationEnabled { get; set; }
}
