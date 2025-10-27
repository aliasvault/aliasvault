//-----------------------------------------------------------------------
// <copyright file="CredentialService.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Services;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Json;
using System.Threading.Tasks;
using AliasClientDb;
using AliasVault.Client.Utilities;
using AliasVault.Shared.Models.WebApi.Favicon;
using Microsoft.EntityFrameworkCore;

/// <summary>
/// Service class for credential operations.
/// </summary>
public sealed class CredentialService(HttpClient httpClient, DbService dbService, Config config, JsInteropService jsInteropService)
{
    /// <summary>
    /// The default service URL used as placeholder in forms. When this value is set, the URL field is considered empty
    /// and a null value is stored in the database.
    /// </summary>
    public const string DefaultServiceUrl = "https://";

    /// <summary>
    /// Generates a random password for a credential using the specified settings.
    /// </summary>
    /// <param name="settings">PasswordSettings model.</param>
    /// <returns>Random password.</returns>
    public async Task<string> GenerateRandomPasswordAsync(PasswordSettings settings)
    {
        // Sanity check: if all settings are false, then default to use lowercase letters only.
        if (!settings.UseLowercase && !settings.UseUppercase && !settings.UseNumbers && !settings.UseSpecialChars && !settings.UseNonAmbiguousChars)
        {
            settings.UseLowercase = true;
        }

        return await jsInteropService.GenerateRandomPasswordAsync(settings);
    }

    /// <summary>
    /// Generates a random identity for a credential.
    /// </summary>
    /// <param name="credential">The credential object to update.</param>
    /// <returns>Task.</returns>
    public async Task<Credential> GenerateRandomIdentityAsync(Credential credential)
    {
        const int MaxAttempts = 5;
        var attempts = 0;
        bool isEmailTaken;

        do
        {
            // Generate a random identity using the TypeScript library
            var identity = await jsInteropService.GenerateRandomIdentityAsync(dbService.Settings.DefaultIdentityLanguage, dbService.Settings.DefaultIdentityGender);

            // Generate random values for the Identity properties
            credential.Username = identity.NickName;
            credential.Alias.FirstName = identity.FirstName;
            credential.Alias.LastName = identity.LastName;
            credential.Alias.NickName = identity.NickName;
            credential.Alias.Gender = identity.Gender;
            credential.Alias.BirthDate = string.IsNullOrEmpty(identity.BirthDate) ? DateTime.MinValue : DateTimeFormatter.Parse(identity.BirthDate);

            // Set the email
            var emailDomain = GetDefaultEmailDomain();
            credential.Alias.Email = $"{identity.EmailPrefix}@{emailDomain}";

            // Check if email is already taken
            try
            {
                var response = await httpClient.PostAsync($"v1/Identity/CheckEmail/{credential.Alias.Email}", null);
                var result = await response.Content.ReadFromJsonAsync<Dictionary<string, bool>>();
                isEmailTaken = result?["isTaken"] ?? false;
            }
            catch
            {
                // If the API call fails, assume email is not taken to allow operation to continue
                isEmailTaken = false;
            }

            attempts++;
        }
        while (isEmailTaken && attempts < MaxAttempts);

        // Generate password using the TypeScript library
        var passwordSettings = dbService.Settings.PasswordSettings;
        credential.Passwords.First().Value = await jsInteropService.GenerateRandomPasswordAsync(passwordSettings);

        return credential;
    }

    /// <summary>
    /// Gets the default email domain based on settings and available domains.
    /// </summary>
    /// <returns>Default email domain.</returns>
    public string GetDefaultEmailDomain()
    {
        var defaultDomain = dbService.Settings.DefaultEmailDomain;

        // Function to check if a domain is valid
        // TODO: "DISABLED.TLD" was a placeholder used < 0.22.0 that has been replaced by an empty string.
        // That value is still here for legacy purposes, but it can be removed from the codebase in a future release.
        bool IsValidDomain(string domain) =>
            !string.IsNullOrEmpty(domain) &&
            domain != "DISABLED.TLD" &&
            (config.PublicEmailDomains.Contains(domain) || config.PrivateEmailDomains.Contains(domain));

        // Get the first valid domain from private or public domains
        string GetFirstValidDomain() =>
            config.PrivateEmailDomains.Find(IsValidDomain) ??
            config.PublicEmailDomains.FirstOrDefault() ??
            "example.com";

        // Use the default domain if it's valid, otherwise get the first valid domain
        string domainToUse = IsValidDomain(defaultDomain) ? defaultDomain : GetFirstValidDomain();

        return domainToUse;
    }

    /// <summary>
    /// Insert new entry into database.
    /// </summary>
    /// <param name="loginObject">Login object to insert.</param>
    /// <param name="saveToDb">Whether to commit changes to database. Defaults to true, but can be set to false if entries are added in bulk by caller.</param>
    /// <param name="extractFavicon">Whether to extract the favicon from the service URL. Defaults to true.</param>
    /// <returns>Guid of inserted entry.</returns>
    public async Task<Guid> InsertEntryAsync(Credential loginObject, bool saveToDb = true, bool extractFavicon = true)
    {
        var context = await dbService.GetDbContextAsync();

        // Try to extract favicon from service URL
        if (extractFavicon)
        {
            await ExtractFaviconAsync(loginObject);
        }

        // If the email starts with an @ it is most likely still the placeholder which hasn't been filled.
        // So we remove it.
        if (loginObject.Alias.Email is not null && loginObject.Alias.Email.StartsWith('@'))
        {
            loginObject.Alias.Email = null;
        }

        // If the URL equals the placeholder, we set it to null.
        if (loginObject.Service.Url == DefaultServiceUrl)
        {
            loginObject.Service.Url = null;
        }

        var currentDateTime = DateTime.UtcNow;
        var login = new Credential
        {
            CreatedAt = currentDateTime,
            UpdatedAt = currentDateTime,
            Notes = loginObject.Notes,
            Username = loginObject.Username,
            Alias = new Alias()
            {
                NickName = loginObject.Alias.NickName,
                FirstName = loginObject.Alias.FirstName,
                LastName = loginObject.Alias.LastName,
                BirthDate = loginObject.Alias.BirthDate,
                Gender = loginObject.Alias.Gender,
                Email = loginObject.Alias.Email,
                CreatedAt = currentDateTime,
                UpdatedAt = currentDateTime,
            },
            Service = new Service()
            {
                Name = loginObject.Service.Name,
                Url = loginObject.Service.Url,
                Logo = loginObject.Service.Logo,
                CreatedAt = currentDateTime,
                UpdatedAt = currentDateTime,
            },
        };

        login.Passwords.Add(new Password()
        {
            Value = loginObject.Passwords.First().Value,
        });

        foreach (var attachment in loginObject.Attachments)
        {
            login.Attachments.Add(attachment);
        }

        // Add TOTP codes
        foreach (var totpCode in loginObject.TotpCodes)
        {
            login.TotpCodes.Add(totpCode);
        }

        context.Credentials.Add(login);

        // Add password.
        login.Passwords.Add(loginObject.Passwords.First());

        // Save the database to the server if saveToDb is true.
        if (saveToDb && !await dbService.SaveDatabaseAsync())
        {
            // If saving database to server failed, return empty guid to indicate error.
            return Guid.Empty;
        }

        return login.Id;
    }

    /// <summary>
    /// Update an existing entry to database.
    /// </summary>
    /// <param name="loginObject">Login object to update.</param>
    /// <returns>Guid of updated entry.</returns>
    public async Task<Guid> UpdateEntryAsync(Credential loginObject)
    {
        var context = await dbService.GetDbContextAsync();

        // Try to extract favicon from service URL
        await ExtractFaviconAsync(loginObject);

        // Get the existing entry.
        var login = await LoadEntryAsync(loginObject.Id);
        if (login is null)
        {
            throw new InvalidOperationException("Login object not found.");
        }

        if (loginObject.Alias.Email is not null && loginObject.Alias.Email.StartsWith('@'))
        {
            loginObject.Alias.Email = null;
        }

        // If the URL equals the placeholder, we set it to null.
        if (loginObject.Service.Url == DefaultServiceUrl)
        {
            loginObject.Service.Url = null;
        }

        // Update all fields and collections with current timestamp.
        var updateDateTime = DateTime.UtcNow;
        UpdateBasicCredentialInfo(login, loginObject, updateDateTime);
        UpdateAttachments(context, login, loginObject);
        UpdateTotpCodes(context, login, loginObject);

        if (!await dbService.SaveDatabaseAsync())
        {
            return Guid.Empty;
        }

        return login.Id;
    }

    /// <summary>
    /// Load existing entry from database.
    /// </summary>
    /// <param name="loginId">Id of login to load.</param>
    /// <returns>Alias object.</returns>
    public async Task<Credential?> LoadEntryAsync(Guid loginId)
    {
        var context = await dbService.GetDbContextAsync();

        var loginObject = await context.Credentials
            .Include(x => x.Passwords)
            .Include(x => x.Alias)
            .Include(x => x.Service)
            .Include(x => x.Attachments)
            .Include(x => x.TotpCodes)
            .Include(x => x.Passkeys)
            .AsSplitQuery()
            .Where(x => x.Id == loginId)
            .Where(x => !x.IsDeleted)
            .FirstOrDefaultAsync();

        if (loginObject != null)
        {
            // Filter out deleted items from collections after loading
            loginObject.Passwords = loginObject.Passwords.Where(p => !p.IsDeleted).ToList();
            loginObject.Attachments = loginObject.Attachments.Where(a => !a.IsDeleted).ToList();
            loginObject.TotpCodes = loginObject.TotpCodes.Where(t => !t.IsDeleted).ToList();
            loginObject.Passkeys = loginObject.Passkeys.Where(p => !p.IsDeleted).ToList();
        }

        return loginObject;
    }

    /// <summary>
    /// Load all entries from database.
    /// </summary>
    /// <returns>Alias object.</returns>
    public async Task<List<Credential>> LoadAllAsync()
    {
        var context = await dbService.GetDbContextAsync();

        var loginObject = await context.Credentials
            .Include(x => x.Passwords.Where(p => !p.IsDeleted))
            .Include(x => x.Alias)
            .Include(x => x.Service)
            .Include(x => x.Attachments.Where(a => !a.IsDeleted))
            .Include(x => x.TotpCodes.Where(t => !t.IsDeleted))
            .Include(x => x.Passkeys.Where(p => !p.IsDeleted))
            .AsSplitQuery()
            .Where(x => !x.IsDeleted)
            .ToListAsync();

        return loginObject;
    }

    /// <summary>
    /// Get list with all login entries.
    /// </summary>
    /// <returns>List of CredentialListEntry objects.</returns>
    public async Task<List<CredentialListEntry>?> GetListAsync()
    {
        var context = await dbService.GetDbContextAsync();

        // Retrieve all aliases from client DB.
        var credentials = await context.Credentials
            .Include(x => x.Alias)
            .Include(x => x.Service)
            .Include(x => x.Passkeys.Where(p => !p.IsDeleted))
            .Include(x => x.Passwords.Where(p => !p.IsDeleted))
            .Include(x => x.Attachments.Where(a => !a.IsDeleted))
            .AsSplitQuery()
            .Where(x => !x.IsDeleted)
            .ToListAsync();

        // Map to CredentialListEntry with proper boolean logic
        return credentials.Select(x => new CredentialListEntry
        {
            Id = x.Id,
            Logo = x.Service.Logo,
            Service = x.Service.Name,
            Username = x.Username,
            Email = x.Alias.Email,
            CreatedAt = x.CreatedAt,
            HasPasskey = x.Passkeys != null && x.Passkeys.Any(),
            HasAlias = !string.IsNullOrWhiteSpace(x.Alias.FirstName) ||
                       !string.IsNullOrWhiteSpace(x.Alias.LastName) ||
                       !string.IsNullOrWhiteSpace(x.Alias.NickName) ||
                       !string.IsNullOrWhiteSpace(x.Alias.Gender) ||
                       x.Alias.BirthDate.Year > 1,
            HasUsernameOrPassword = !string.IsNullOrWhiteSpace(x.Username) ||
                                    (x.Passwords != null && x.Passwords.Any(p => !string.IsNullOrWhiteSpace(p.Value))),
            HasAttachment = x.Attachments != null && x.Attachments.Any(),
        }).ToList();
    }

    /// <summary>
    /// Soft deletes an existing entry from database. NOTE: all user actions should be handled via this soft deletion.
    /// Permanently deleting entries is handled by periodic database cleanup job. The soft-delete mechanism
    /// is required in order to synchronize the deletion of entries across multiple client vault versions.
    /// </summary>
    /// <param name="id">Id of alias to delete.</param>
    /// <returns>Bool which indicates if deletion and saving database was successful.</returns>
    public async Task<bool> SoftDeleteEntryAsync(Guid id)
    {
        var context = await dbService.GetDbContextAsync();

        var login = await context.Credentials
            .Include(x => x.Passkeys)
            .Where(x => x.Id == id)
            .FirstAsync();

        var deleteDateTime = DateTime.UtcNow;

        login.IsDeleted = true;
        login.UpdatedAt = deleteDateTime;

        // Mark associated alias and service as deleted
        var alias = await context.Aliases
            .Where(x => x.Id == login.Alias.Id)
            .FirstAsync();
        alias.IsDeleted = true;
        alias.UpdatedAt = deleteDateTime;

        var service = await context.Services
            .Where(x => x.Id == login.Service.Id)
            .FirstAsync();
        service.IsDeleted = true;
        service.UpdatedAt = deleteDateTime;

        // Mark associated passkeys as deleted
        foreach (var passkey in login.Passkeys)
        {
            passkey.IsDeleted = true;
            passkey.UpdatedAt = deleteDateTime;
        }

        return await dbService.SaveDatabaseAsync();
    }

    /// <summary>
    /// Hard delete all credentials from the database. This permanently removes all credential records
    /// (including soft-deleted ones) from the database for a complete vault reset.
    /// </summary>
    /// <returns>True if successful, false otherwise.</returns>
    public async Task<bool> HardDeleteAllCredentialsAsync()
    {
        var context = await dbService.GetDbContextAsync();

        // Hard delete all attachments, aliases, services and credentials.
        context.Attachments.RemoveRange(context.Attachments);
        context.Aliases.RemoveRange(context.Aliases);
        context.Services.RemoveRange(context.Services);
        context.Credentials.RemoveRange(context.Credentials);

        // Save changes locally
        await context.SaveChangesAsync();

        // Save the database to server
        return await dbService.SaveDatabaseAsync();
    }

    /// <summary>
    /// Deletes a passkey by marking it as deleted.
    /// </summary>
    /// <param name="passkeyId">The ID of the passkey to delete.</param>
    /// <returns>A value indicating whether the deletion was successful.</returns>
    public async Task<bool> DeletePasskeyAsync(Guid passkeyId)
    {
        var context = await dbService.GetDbContextAsync();
        var passkey = await context.Passkeys.FirstOrDefaultAsync(p => p.Id == passkeyId);

        if (passkey != null)
        {
            var deleteDateTime = DateTime.UtcNow;
            passkey.IsDeleted = true;
            passkey.UpdatedAt = deleteDateTime;
            await context.SaveChangesAsync();

            // Save to server
            return await dbService.SaveDatabaseAsync();
        }

        return false;
    }

    /// <summary>
    /// Update the basic credential information.
    /// </summary>
    /// <param name="login">The login object to update.</param>
    /// <param name="loginObject">The login object to update from.</param>
    /// <param name="updateDateTime">The datetime to use for UpdatedAt fields.</param>
    private static void UpdateBasicCredentialInfo(Credential login, Credential loginObject, DateTime updateDateTime)
    {
        login.UpdatedAt = updateDateTime;
        login.Notes = loginObject.Notes;
        login.Username = loginObject.Username;

        login.Alias.NickName = loginObject.Alias.NickName;
        login.Alias.FirstName = loginObject.Alias.FirstName;
        login.Alias.LastName = loginObject.Alias.LastName;
        login.Alias.BirthDate = loginObject.Alias.BirthDate;
        login.Alias.Gender = loginObject.Alias.Gender;
        login.Alias.Email = loginObject.Alias.Email;
        login.Alias.UpdatedAt = updateDateTime;

        login.Passwords = loginObject.Passwords;
        if (login.Passwords.Count > 0)
        {
            login.Passwords.First().UpdatedAt = updateDateTime;
        }

        login.Service.Name = loginObject.Service.Name;
        login.Service.Url = loginObject.Service.Url;
        login.Service.Logo = loginObject.Service.Logo;
        login.Service.UpdatedAt = updateDateTime;
    }

    /// <summary>
    /// Update the attachments.
    /// </summary>
    /// <param name="context">The database context.</param>
    /// <param name="login">The login object to update.</param>
    /// <param name="loginObject">The login object to update from.</param>
    private static void UpdateAttachments(DbContext context, Credential login, Credential loginObject)
    {
        var attachmentsToRemove = login.Attachments
            .Where(existingAttachment => !loginObject.Attachments.Any(a => a.Id == existingAttachment.Id))
            .ToList();

        foreach (var attachmentToRemove in attachmentsToRemove)
        {
            login.Attachments.Remove(attachmentToRemove);
            context.Entry(attachmentToRemove).State = EntityState.Deleted;
        }

        foreach (var attachment in loginObject.Attachments)
        {
            if (attachment.Id != Guid.Empty)
            {
                var existingAttachment = login.Attachments.FirstOrDefault(a => a.Id == attachment.Id);
                if (existingAttachment != null)
                {
                    context.Entry(existingAttachment).CurrentValues.SetValues(attachment);
                }
            }
            else
            {
                login.Attachments.Add(attachment);
            }
        }
    }

    /// <summary>
    /// Update the TOTP codes.
    /// </summary>
    /// <param name="context">The database context.</param>
    /// <param name="login">The login object to update.</param>
    /// <param name="loginObject">The login object to update from.</param>
    private static void UpdateTotpCodes(DbContext context, Credential login, Credential loginObject)
    {
        var totpCodesToRemove = login.TotpCodes
            .Where(existingTotp => !loginObject.TotpCodes.Any(t => t.Id == existingTotp.Id))
            .ToList();

        foreach (var totpToRemove in totpCodesToRemove)
        {
            login.TotpCodes.Remove(totpToRemove);
            context.Entry(totpToRemove).State = EntityState.Deleted;
        }

        foreach (var totpCode in loginObject.TotpCodes)
        {
            if (totpCode.Id != Guid.Empty)
            {
                var existingTotpCode = login.TotpCodes.FirstOrDefault(t => t.Id == totpCode.Id);
                if (existingTotpCode != null)
                {
                    context.Entry(existingTotpCode).CurrentValues.SetValues(totpCode);
                }
            }
            else
            {
                login.TotpCodes.Add(totpCode);
            }
        }
    }

    /// <summary>
    /// Extract favicon from service URL if available in object. If successful the passed object itself will be updated with the bytes.
    /// </summary>
    /// <param name="credentialObject">The Credential object to extract the favicon for.</param>
    /// <returns>Task.</returns>
    private async Task ExtractFaviconAsync(Credential credentialObject)
    {
        // Try to extract favicon from service URL
        var url = credentialObject.Service.Url;
        if (url != null && !string.IsNullOrEmpty(url))
        {
            // Request favicon from service URL via WebApi
            try
            {
                var apiReturn =
                    await httpClient.GetFromJsonAsync<FaviconExtractModel>($"v1/Favicon/Extract?url={url}");
                if (apiReturn?.Image is not null)
                {
                    credentialObject.Service.Logo = apiReturn.Image;
                }
            }
            catch
            {
                // Ignore favicon extraction errors
            }
        }
    }
}
