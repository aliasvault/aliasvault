//-----------------------------------------------------------------------
// <copyright file="CredentialEdit.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Main.Models;

using System;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations;
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using AliasClientDb;
using AliasVault.Client.Main.Models.FormValidation;
using AliasVault.Client.Resources;

/// <summary>
/// Credential edit model.
/// </summary>
public sealed class CredentialEdit
{
    /// <summary>
    /// Gets or sets the Id of the login.
    /// </summary>
    public Guid Id { get; set; }

    /// <summary>
    /// Gets or sets notes field (free text input).
    /// </summary>
    public string Notes { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets username field.
    /// </summary>
    public string Username { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the name of the service.
    /// </summary>
    [Required(ErrorMessageResourceType = typeof(ValidationMessages), ErrorMessageResourceName = nameof(ValidationMessages.ServiceNameRequired))]
    [Display(Name = "Service Name")]
    public string ServiceName { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the URL of the service.
    /// </summary>
    public string? ServiceUrl { get; set; }

    /// <summary>
    /// Gets or sets the logo of the service.
    /// </summary>
    public byte[]? ServiceLogo { get; set; }

    /// <summary>
    /// Gets or sets the Alias Identity object.
    /// </summary>
    public Alias Alias { get; set; } = null!;

    /// <summary>
    /// Gets or sets the Alias BirthDate. Can be empty string or a date in yyyy-MM-dd format.
    /// </summary>
    [StringDateFormat("yyyy-MM-dd", AllowEmpty = true)]
    public string AliasBirthDate { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the Alias Password object.
    /// </summary>
    public Password Password { get; set; } = null!;

    /// <summary>
    /// Gets or sets the Alias CreateDate.
    /// </summary>
    public DateTime CreateDate { get; set; }

    /// <summary>
    /// Gets or sets the Alias LastUpdate.
    /// </summary>
    public DateTime LastUpdate { get; set; }

    /// <summary>
    /// Gets or sets the Attachment list.
    /// </summary>
    public List<Attachment> Attachments { get; set; } = [];

    /// <summary>
    /// Gets or sets the TOTP codes list.
    /// </summary>
    public List<TotpCode> TotpCodes { get; set; } = [];

    /// <summary>
    /// Creates a CredentialEdit instance from a Credential entity.
    /// </summary>
    /// <param name="credential">The credential entity to convert.</param>
    /// <returns>A new CredentialEdit instance.</returns>
    public static CredentialEdit FromEntity(Credential credential)
    {
        // Create a deep copy of the credential object to prevent changes to the original object
        var options = new JsonSerializerOptions
        {
            ReferenceHandler = ReferenceHandler.Preserve,
            MaxDepth = 128,
        };

        // Create a deep copy of the credential object
        var credentialJson = JsonSerializer.Serialize(credential, options);
        var credentialCopy = JsonSerializer.Deserialize<Credential>(credentialJson, options)!;

        return new CredentialEdit
        {
            Id = credentialCopy.Id,
            Notes = credentialCopy.Notes ?? string.Empty,
            Username = credentialCopy.Username ?? string.Empty,
            ServiceName = credentialCopy.Service.Name ?? string.Empty,
            ServiceUrl = credentialCopy.Service.Url,
            ServiceLogo = credentialCopy.Service.Logo,
            Password = credentialCopy.Passwords.FirstOrDefault() ?? new Password
            {
                Value = string.Empty,
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow,
            },
            Alias = credentialCopy.Alias,
            AliasBirthDate = credentialCopy.Alias.BirthDate == DateTime.MinValue ? string.Empty : credentialCopy.Alias.BirthDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            Attachments = credentialCopy.Attachments.ToList(),
            TotpCodes = credentialCopy.TotpCodes.ToList(),
            CreateDate = credentialCopy.CreatedAt,
            LastUpdate = credentialCopy.UpdatedAt,
        };
    }

    /// <summary>
    /// Converts this CredentialEdit instance to a Credential entity.
    /// </summary>
    /// <returns>A new Credential entity.</returns>
    public Credential ToEntity()
    {
        var credential = new Credential
        {
            Id = Id,
            Notes = Notes,
            Username = Username,
            Service = new Service
            {
                Name = ServiceName,
                Url = ServiceUrl,
                Logo = ServiceLogo,
            },
            Passwords =
            [
                Password,
            ],
            Alias = Alias,
            Attachments = Attachments,
            TotpCodes = TotpCodes,
        };

        if (string.IsNullOrWhiteSpace(AliasBirthDate))
        {
            credential.Alias.BirthDate = DateTime.MinValue;
        }
        else
        {
            credential.Alias.BirthDate = DateTime.Parse(AliasBirthDate, CultureInfo.InvariantCulture);
        }

        return credential;
    }
}
