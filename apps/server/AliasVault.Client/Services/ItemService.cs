//-----------------------------------------------------------------------
// <copyright file="ItemService.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Services;

using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading.Tasks;
using AliasClientDb;
using AliasClientDb.Models;
using AliasVault.Client.Main.Models;
using AliasVault.Client.Utilities;
using AliasVault.Shared.Models.WebApi.Favicon;
using Microsoft.EntityFrameworkCore;

/// <summary>
/// Service class for Item operations.
/// </summary>
public sealed class ItemService(HttpClient httpClient, DbService dbService, Config config, JsInteropService jsInteropService)
{
    /// <summary>
    /// The default service URL used as placeholder in forms. When this value is set, the URL field is considered empty
    /// and a null value is stored in the database.
    /// </summary>
    public const string DefaultServiceUrl = "https://";

    /// <summary>
    /// Generates a random password for an item using the specified settings.
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
    /// Generates a random identity for an item.
    /// </summary>
    /// <param name="item">The item to update with random identity.</param>
    /// <returns>Task with the updated item.</returns>
    public async Task<Item> GenerateRandomIdentityAsync(Item item)
    {
        const int MaxAttempts = 5;
        var attempts = 0;
        bool isEmailTaken;

        do
        {
            // Convert age range to birthdate options using shared JS utility
            var birthdateOptions = await jsInteropService.ConvertAgeRangeToBirthdateOptionsAsync(dbService.Settings.DefaultIdentityAgeRange);

            // Get the effective identity language (smart default based on UI language if no explicit override is set)
            var identityLanguage = await GetEffectiveIdentityLanguageAsync();

            // Generate a random identity using the TypeScript library
            var identity = await jsInteropService.GenerateRandomIdentityAsync(identityLanguage, dbService.Settings.DefaultIdentityGender, birthdateOptions);

            // Set username field
            SetFieldValue(item, FieldKey.LoginUsername, identity.NickName);

            // Set alias fields
            SetFieldValue(item, FieldKey.AliasFirstName, identity.FirstName);
            SetFieldValue(item, FieldKey.AliasLastName, identity.LastName);
            SetFieldValue(item, FieldKey.AliasGender, identity.Gender);

            if (!string.IsNullOrEmpty(identity.BirthDate))
            {
                // Parse the birthdate and format as yyyy-MM-dd
                if (DateTime.TryParse(identity.BirthDate, out var birthDate))
                {
                    SetFieldValue(item, FieldKey.AliasBirthdate, birthDate.ToString("yyyy-MM-dd"));
                }
                else
                {
                    SetFieldValue(item, FieldKey.AliasBirthdate, identity.BirthDate);
                }
            }

            // Set the email
            var emailDomain = GetDefaultEmailDomain();
            var email = $"{identity.EmailPrefix}@{emailDomain}";
            SetFieldValue(item, FieldKey.LoginEmail, email);

            // Check if email is already taken
            try
            {
                var response = await httpClient.PostAsync($"v1/Identity/CheckEmail/{email}", null);
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
        var password = await jsInteropService.GenerateRandomPasswordAsync(passwordSettings);
        SetFieldValue(item, FieldKey.LoginPassword, password);

        return item;
    }

    /// <summary>
    /// Gets the default email domain based on settings and available domains.
    /// </summary>
    /// <returns>Default email domain.</returns>
    public string GetDefaultEmailDomain()
    {
        var defaultDomain = dbService.Settings.DefaultEmailDomain;

        // Function to check if a domain is valid (not disabled, not hidden, and exists in domain lists)
        bool IsValidDomain(string domain) =>
            !string.IsNullOrEmpty(domain) &&
            domain != "DISABLED.TLD" &&
            !config.HiddenPrivateEmailDomains.Contains(domain) &&
            (config.PublicEmailDomains.Contains(domain) || config.PrivateEmailDomains.Contains(domain));

        // Get the first valid domain from private or public domains (excluding hidden ones)
        string GetFirstValidDomain() =>
            config.PrivateEmailDomains.Find(IsValidDomain) ??
            config.PublicEmailDomains.FirstOrDefault() ??
            "example.com";

        // Use the default domain if it's valid (not hidden), otherwise get the first valid domain
        string domainToUse = IsValidDomain(defaultDomain) ? defaultDomain : GetFirstValidDomain();

        return domainToUse;
    }

    /// <summary>
    /// Insert new item into database.
    /// </summary>
    /// <param name="item">Item to insert.</param>
    /// <param name="saveToDb">Whether to commit changes to database. Defaults to true.</param>
    /// <param name="extractFavicon">Whether to extract the favicon from the service URL. Defaults to true.</param>
    /// <returns>Guid of inserted entry.</returns>
    public async Task<Guid> InsertEntryAsync(Item item, bool saveToDb = true, bool extractFavicon = true)
    {
        var context = await dbService.GetDbContextAsync();

        // Try to extract favicon from service URL
        if (extractFavicon)
        {
            await ExtractFaviconAsync(item);
        }

        // Clean up email if it starts with @ (placeholder not filled)
        var email = GetFieldValue(item, FieldKey.LoginEmail);
        if (email != null && email.StartsWith('@'))
        {
            RemoveFieldValue(item, FieldKey.LoginEmail);
        }

        // If the URL equals the placeholder, remove it
        var url = GetFieldValue(item, FieldKey.LoginUrl);
        if (url == DefaultServiceUrl)
        {
            RemoveFieldValue(item, FieldKey.LoginUrl);
        }

        var currentDateTime = DateTime.UtcNow;
        item.Id = Guid.NewGuid();
        item.CreatedAt = currentDateTime;
        item.UpdatedAt = currentDateTime;

        // Set timestamps on all field values and their FieldDefinitions
        foreach (var fv in item.FieldValues)
        {
            fv.Id = Guid.NewGuid();
            fv.ItemId = item.Id;
            fv.CreatedAt = currentDateTime;
            fv.UpdatedAt = currentDateTime;

            // If this field value has a new FieldDefinition (custom field), ensure its timestamps are set
            if (fv.FieldDefinition != null)
            {
                if (fv.FieldDefinition.CreatedAt == default)
                {
                    fv.FieldDefinition.CreatedAt = currentDateTime;
                }

                if (fv.FieldDefinition.UpdatedAt == default)
                {
                    fv.FieldDefinition.UpdatedAt = currentDateTime;
                }

                // Add the FieldDefinition explicitly to ensure it's tracked
                context.FieldDefinitions.Add(fv.FieldDefinition);
            }
        }

        // Set timestamps on attachments
        foreach (var attachment in item.Attachments)
        {
            attachment.ItemId = item.Id;
            attachment.CreatedAt = currentDateTime;
            attachment.UpdatedAt = currentDateTime;
        }

        // Set timestamps on TOTP codes
        foreach (var totpCode in item.TotpCodes)
        {
            totpCode.ItemId = item.Id;
            totpCode.CreatedAt = currentDateTime;
            totpCode.UpdatedAt = currentDateTime;
        }

        // Create history records for fields with EnableHistory=true
        await CreateInitialFieldHistoryAsync(context, item, currentDateTime);

        context.Items.Add(item);

        // Save the database to the server if saveToDb is true.
        if (saveToDb && !await dbService.SaveDatabaseAsync())
        {
            // If saving database to server failed, return empty guid to indicate error.
            return Guid.Empty;
        }

        return item.Id;
    }

    /// <summary>
    /// Update an existing item in database.
    /// </summary>
    /// <param name="item">Item to update.</param>
    /// <returns>Guid of updated entry.</returns>
    public async Task<Guid> UpdateEntryAsync(Item item)
    {
        var context = await dbService.GetDbContextAsync();

        // Try to extract favicon from service URL
        await ExtractFaviconAsync(item);

        // Get the existing entry.
        var existingItem = await LoadEntryAsync(item.Id);
        if (existingItem is null)
        {
            throw new InvalidOperationException("Item not found.");
        }

        // Clean up email if it starts with @ (placeholder not filled)
        var email = GetFieldValue(item, FieldKey.LoginEmail);
        if (email != null && email.StartsWith('@'))
        {
            RemoveFieldValue(item, FieldKey.LoginEmail);
        }

        // If the URL equals the placeholder, remove it
        var url = GetFieldValue(item, FieldKey.LoginUrl);
        if (url == DefaultServiceUrl)
        {
            RemoveFieldValue(item, FieldKey.LoginUrl);
        }

        var updateDateTime = DateTime.UtcNow;

        // Check if item type has changed
        var typeChanged = existingItem.ItemType != item.ItemType;

        // Update basic item info only if values changed
        var itemLevelChanged = existingItem.Name != item.Name || existingItem.ItemType != item.ItemType || existingItem.LogoId != item.LogoId || existingItem.FolderId != item.FolderId;

        if (itemLevelChanged)
        {
            existingItem.Name = item.Name;
            existingItem.ItemType = item.ItemType;
            existingItem.LogoId = item.LogoId;
            existingItem.FolderId = item.FolderId;
            existingItem.UpdatedAt = updateDateTime;
        }

        // Clear inapplicable fields/relations when type changes
        if (typeChanged && item.ItemType != null)
        {
            ClearInapplicableData(context, existingItem, item.ItemType, updateDateTime);
        }

        // Track history for fields with EnableHistory=true before updating
        await TrackFieldHistoryAsync(context, existingItem, item, updateDateTime);

        // Update field values
        UpdateFieldValues(context, existingItem, item, updateDateTime);

        // Update attachments
        UpdateAttachments(context, existingItem, item, updateDateTime);

        // Update TOTP codes
        UpdateTotpCodes(context, existingItem, item, updateDateTime);

        if (!await dbService.SaveDatabaseAsync())
        {
            return Guid.Empty;
        }

        return existingItem.Id;
    }

    /// <summary>
    /// Load existing item from database.
    /// </summary>
    /// <param name="itemId">Id of item to load.</param>
    /// <returns>Item object or null if not found.</returns>
    public async Task<Item?> LoadEntryAsync(Guid itemId)
    {
        var context = await dbService.GetDbContextAsync();

        var item = await context.Items
            .Include(x => x.FieldValues.Where(fv => !fv.IsDeleted))
                .ThenInclude(fv => fv.FieldDefinition)
            .Include(x => x.Logo)
            .Include(x => x.Attachments.Where(a => !a.IsDeleted))
            .Include(x => x.TotpCodes.Where(t => !t.IsDeleted))
            .Include(x => x.Passkeys.Where(p => !p.IsDeleted))
            .AsSplitQuery()
            .Where(x => x.Id == itemId)
            .Where(x => !x.IsDeleted)
            .FirstOrDefaultAsync();

        return item;
    }

    /// <summary>
    /// Load all items from database.
    /// </summary>
    /// <returns>List of all items.</returns>
    public async Task<List<Item>> LoadAllAsync()
    {
        var context = await dbService.GetDbContextAsync();

        var items = await context.Items
            .Include(x => x.FieldValues.Where(fv => !fv.IsDeleted))
                .ThenInclude(fv => fv.FieldDefinition)
            .Include(x => x.Logo)
            .Include(x => x.Attachments.Where(a => !a.IsDeleted))
            .Include(x => x.TotpCodes.Where(t => !t.IsDeleted))
            .Include(x => x.Passkeys.Where(p => !p.IsDeleted))
            .AsSplitQuery()
            .Where(x => !x.IsDeleted)
            .Where(x => x.DeletedAt == null) // Exclude items in trash
            .ToListAsync();

        return items;
    }

    /// <summary>
    /// Get list with all item entries for display.
    /// </summary>
    /// <returns>List of ItemListEntry objects.</returns>
    public async Task<List<ItemListEntry>?> GetListAsync()
    {
        var context = await dbService.GetDbContextAsync();

        // Retrieve all items from client DB.
        var items = await context.Items
            .Include(x => x.FieldValues.Where(fv => !fv.IsDeleted))
            .Include(x => x.Logo)
            .Include(x => x.Folder)
            .Include(x => x.Passkeys.Where(p => !p.IsDeleted))
            .Include(x => x.Attachments.Where(a => !a.IsDeleted))
            .Include(x => x.TotpCodes.Where(t => !t.IsDeleted))
            .AsSplitQuery()
            .Where(x => !x.IsDeleted)
            .Where(x => x.DeletedAt == null) // Exclude items in trash
            .ToListAsync();

        // Map to ItemListEntry with proper boolean logic
        return items.Select(x => new ItemListEntry
        {
            Id = x.Id,
            ItemType = x.ItemType ?? AliasClientDb.Models.ItemType.Login,
            Logo = x.Logo?.FileData,
            Service = x.Name,
            Username = GetFieldValue(x, FieldKey.LoginUsername),
            Email = GetFieldValue(x, FieldKey.LoginEmail),
            CardNumber = GetFieldValue(x, FieldKey.CardNumber),
            CreatedAt = x.CreatedAt,
            HasPasskey = x.Passkeys != null && x.Passkeys.Any(p => !p.IsDeleted),
            HasAlias = !string.IsNullOrWhiteSpace(GetFieldValue(x, FieldKey.AliasFirstName)) ||
                       !string.IsNullOrWhiteSpace(GetFieldValue(x, FieldKey.AliasLastName)) ||
                       !string.IsNullOrWhiteSpace(GetFieldValue(x, FieldKey.AliasGender)) ||
                       !string.IsNullOrWhiteSpace(GetFieldValue(x, FieldKey.AliasBirthdate)),
            HasUsernameOrPassword = !string.IsNullOrWhiteSpace(GetFieldValue(x, FieldKey.LoginUsername)) ||
                                    !string.IsNullOrWhiteSpace(GetFieldValue(x, FieldKey.LoginPassword)),
            HasAttachment = x.Attachments != null && x.Attachments.Any(a => !a.IsDeleted),
            HasTotp = x.TotpCodes != null && x.TotpCodes.Any(t => !t.IsDeleted),
            FolderId = x.FolderId,
            FolderName = x.Folder?.Name,
        }).ToList();
    }

    /// <summary>
    /// Soft deletes an existing item from database by moving it to trash.
    /// </summary>
    /// <param name="id">Id of item to delete.</param>
    /// <returns>Bool which indicates if deletion and saving database was successful.</returns>
    public async Task<bool> TrashItemAsync(Guid id)
    {
        var context = await dbService.GetDbContextAsync();

        var item = await context.Items
            .Include(x => x.Passkeys)
            .Where(x => x.Id == id)
            .FirstAsync();

        var deleteDateTime = DateTime.UtcNow;

        // Move to trash (soft delete)
        item.DeletedAt = deleteDateTime;
        item.UpdatedAt = deleteDateTime;

        return await dbService.SaveDatabaseAsync();
    }

    /// <summary>
    /// Soft deletes an existing item from database by moving it to trash.
    /// Syncs to server in the background without blocking the UI.
    /// </summary>
    /// <param name="id">Id of item to delete.</param>
    /// <returns>Task that completes after local mutation.</returns>
    public async Task TrashItemInBackgroundAsync(Guid id)
    {
        var context = await dbService.GetDbContextAsync();

        var item = await context.Items
            .Include(x => x.Passkeys)
            .Where(x => x.Id == id)
            .FirstAsync();

        var deleteDateTime = DateTime.UtcNow;

        // Move to trash (soft delete)
        item.DeletedAt = deleteDateTime;
        item.UpdatedAt = deleteDateTime;

        // Save locally and sync to server in background
        await context.SaveChangesAsync();
        dbService.SaveDatabaseInBackground();
    }

    /// <summary>
    /// Restores an item from the trash (clears DeletedAt).
    /// </summary>
    /// <param name="id">Id of item to restore.</param>
    /// <returns>Bool which indicates if restoration was successful.</returns>
    public async Task<bool> RestoreItemAsync(Guid id)
    {
        var context = await dbService.GetDbContextAsync();

        var item = await context.Items
            .Where(x => x.Id == id && x.DeletedAt != null && !x.IsDeleted)
            .FirstOrDefaultAsync();

        if (item == null)
        {
            return false;
        }

        var restoreDateTime = DateTime.UtcNow;

        // Restore from trash (clear DeletedAt)
        item.DeletedAt = null;
        item.UpdatedAt = restoreDateTime;

        return await dbService.SaveDatabaseAsync();
    }

    /// <summary>
    /// Restores an item from the trash (clears DeletedAt).
    /// Syncs to server in the background without blocking the UI.
    /// </summary>
    /// <param name="id">Id of item to restore.</param>
    /// <returns>True if item was found and restored locally, false if not found.</returns>
    public async Task<bool> RestoreItemInBackgroundAsync(Guid id)
    {
        var context = await dbService.GetDbContextAsync();

        var item = await context.Items
            .Where(x => x.Id == id && x.DeletedAt != null && !x.IsDeleted)
            .FirstOrDefaultAsync();

        if (item == null)
        {
            return false;
        }

        var restoreDateTime = DateTime.UtcNow;

        // Restore from trash (clear DeletedAt)
        item.DeletedAt = null;
        item.UpdatedAt = restoreDateTime;

        // Save locally and sync to server in background
        await context.SaveChangesAsync();
        dbService.SaveDatabaseInBackground();
        return true;
    }

    /// <summary>
    /// Gets all items that are in the trash (DeletedAt is set but IsDeleted is false).
    /// </summary>
    /// <returns>List of trashed items.</returns>
    public async Task<List<Item>> GetRecentlyDeletedAsync()
    {
        var context = await dbService.GetDbContextAsync();

        var items = await context.Items
            .Include(x => x.FieldValues.Where(fv => !fv.IsDeleted))
                .ThenInclude(fv => fv.FieldDefinition)
            .Include(x => x.Logo)
            .AsSplitQuery()
            .Where(x => !x.IsDeleted && x.DeletedAt != null)
            .OrderByDescending(x => x.DeletedAt)
            .ToListAsync();

        return items;
    }

    /// <summary>
    /// Permanently deletes an item (sets IsDeleted = true).
    /// </summary>
    /// <param name="id">Id of item to permanently delete.</param>
    /// <returns>Bool which indicates if deletion was successful.</returns>
    public async Task<bool> PermanentlyDeleteItemAsync(Guid id)
    {
        var context = await dbService.GetDbContextAsync();

        var item = await context.Items
            .Include(x => x.FieldValues)
            .Include(x => x.Passkeys)
            .Include(x => x.Attachments)
            .Include(x => x.TotpCodes)
            .Where(x => x.Id == id)
            .FirstAsync();

        var deleteDateTime = DateTime.UtcNow;

        // Mark item and all related entities as deleted
        item.IsDeleted = true;
        item.UpdatedAt = deleteDateTime;

        foreach (var fv in item.FieldValues)
        {
            fv.IsDeleted = true;
            fv.UpdatedAt = deleteDateTime;
        }

        foreach (var passkey in item.Passkeys)
        {
            passkey.IsDeleted = true;
            passkey.UpdatedAt = deleteDateTime;
        }

        foreach (var attachment in item.Attachments)
        {
            attachment.IsDeleted = true;
            attachment.UpdatedAt = deleteDateTime;
        }

        foreach (var totp in item.TotpCodes)
        {
            totp.IsDeleted = true;
            totp.UpdatedAt = deleteDateTime;
        }

        // Also delete field histories (queried separately since no navigation property)
        var fieldHistories = await context.FieldHistories
            .Where(fh => fh.ItemId == id && !fh.IsDeleted)
            .ToListAsync();

        foreach (var history in fieldHistories)
        {
            history.IsDeleted = true;
            history.UpdatedAt = deleteDateTime;
        }

        return await dbService.SaveDatabaseAsync();
    }

    /// <summary>
    /// Permanently deletes an item (sets IsDeleted = true).
    /// Syncs to server in the background without blocking the UI.
    /// </summary>
    /// <param name="id">Id of item to permanently delete.</param>
    /// <returns>Task that completes after local mutation.</returns>
    public async Task PermanentlyDeleteItemInBackgroundAsync(Guid id)
    {
        var context = await dbService.GetDbContextAsync();

        var item = await context.Items
            .Include(x => x.FieldValues)
            .Include(x => x.Passkeys)
            .Include(x => x.Attachments)
            .Include(x => x.TotpCodes)
            .Where(x => x.Id == id)
            .FirstAsync();

        var deleteDateTime = DateTime.UtcNow;

        // Mark item and all related entities as deleted
        item.IsDeleted = true;
        item.UpdatedAt = deleteDateTime;

        foreach (var fv in item.FieldValues)
        {
            fv.IsDeleted = true;
            fv.UpdatedAt = deleteDateTime;
        }

        foreach (var passkey in item.Passkeys)
        {
            passkey.IsDeleted = true;
            passkey.UpdatedAt = deleteDateTime;
        }

        foreach (var attachment in item.Attachments)
        {
            attachment.IsDeleted = true;
            attachment.UpdatedAt = deleteDateTime;
        }

        foreach (var totp in item.TotpCodes)
        {
            totp.IsDeleted = true;
            totp.UpdatedAt = deleteDateTime;
        }

        // Also delete field histories (queried separately since no navigation property)
        var fieldHistories = await context.FieldHistories
            .Where(fh => fh.ItemId == id && !fh.IsDeleted)
            .ToListAsync();

        foreach (var history in fieldHistories)
        {
            history.IsDeleted = true;
            history.UpdatedAt = deleteDateTime;
        }

        // Save locally and sync to server in background
        await context.SaveChangesAsync();
        dbService.SaveDatabaseInBackground();
    }

    /// <summary>
    /// Hard delete all items from the database. This permanently removes all item records
    /// (including soft-deleted ones) from the database for a complete vault reset.
    /// Also removes all folders.
    /// </summary>
    /// <returns>True if successful, false otherwise.</returns>
    public async Task<bool> HardDeleteAllItemsAsync()
    {
        var context = await dbService.GetDbContextAsync();

        // Hard delete all related entities and items.
        context.Attachments.RemoveRange(context.Attachments);
        context.FieldValues.RemoveRange(context.FieldValues);
        context.FieldHistories.RemoveRange(context.FieldHistories);
        context.TotpCodes.RemoveRange(context.TotpCodes);
        context.Passkeys.RemoveRange(context.Passkeys);
        context.Items.RemoveRange(context.Items);
        context.Logos.RemoveRange(context.Logos);
        context.Folders.RemoveRange(context.Folders);

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
    /// Get field history for a specific item and field.
    /// </summary>
    /// <param name="itemId">The item ID.</param>
    /// <param name="fieldKey">The field key.</param>
    /// <returns>List of field history records.</returns>
    public async Task<List<FieldHistory>> GetFieldHistoryAsync(Guid itemId, string fieldKey)
    {
        var context = await dbService.GetDbContextAsync();

        return await context.FieldHistories
            .Where(fh => fh.ItemId == itemId && fh.FieldKey == fieldKey && !fh.IsDeleted)
            .OrderByDescending(fh => fh.ChangedAt)
            .Take(10)
            .ToListAsync();
    }

    /// <summary>
    /// Get field history count for a specific item and field.
    /// Returns the count only if history is meaningful (more than 1 record,
    /// or 1 record with value different from current).
    /// </summary>
    /// <param name="itemId">The item ID.</param>
    /// <param name="fieldKey">The field key.</param>
    /// <param name="currentValue">The current field value to compare against.</param>
    /// <returns>Number of history records if meaningful, 0 otherwise.</returns>
    public async Task<int> GetFieldHistoryCountAsync(Guid itemId, string fieldKey, string? currentValue = null)
    {
        var context = await dbService.GetDbContextAsync();

        var historyRecords = await context.FieldHistories
            .Where(fh => fh.ItemId == itemId && fh.FieldKey == fieldKey && !fh.IsDeleted)
            .OrderByDescending(fh => fh.ChangedAt)
            .Take(2) // Only need to check first 2 records
            .ToListAsync();

        var count = historyRecords.Count;

        if (count > 1)
        {
            // More than 1 history record - always show icon
            return await context.FieldHistories
                .Where(fh => fh.ItemId == itemId && fh.FieldKey == fieldKey && !fh.IsDeleted)
                .CountAsync();
        }

        if (count == 1 && currentValue != null)
        {
            // Single history record - check if value differs from current
            var historyValue = historyRecords[0].ValueSnapshot;
            var currentValueJson = JsonSerializer.Serialize(new[] { currentValue }.Where(v => !string.IsNullOrWhiteSpace(v)));

            // Only show icon if history value differs from current value
            if (currentValueJson != historyValue)
            {
                return 1;
            }
        }

        return 0;
    }

    /// <summary>
    /// Delete a specific field history record.
    /// </summary>
    /// <param name="historyId">The ID of the history record to delete.</param>
    /// <returns>True if deleted, false otherwise.</returns>
    public async Task<bool> DeleteFieldHistoryAsync(Guid historyId)
    {
        var context = await dbService.GetDbContextAsync();

        var history = await context.FieldHistories
            .FirstOrDefaultAsync(fh => fh.Id == historyId && !fh.IsDeleted);

        if (history == null)
        {
            return false;
        }

        history.IsDeleted = true;
        history.UpdatedAt = DateTime.UtcNow;

        await context.SaveChangesAsync();
        return true;
    }

    /// <summary>
    /// Gets a field value from an item by field key.
    /// </summary>
    /// <param name="item">The item to get the field from.</param>
    /// <param name="fieldKey">The field key.</param>
    /// <returns>The field value or null.</returns>
#pragma warning disable SA1204 // Static members should appear before non-static members
    public static string? GetFieldValue(Item item, string fieldKey)
#pragma warning restore SA1204
    {
        return item.FieldValues
            .FirstOrDefault(fv => fv.FieldKey == fieldKey && !fv.IsDeleted)
            ?.Value;
    }

    /// <summary>
    /// Gets all field values for a multi-value field key.
    /// </summary>
    /// <param name="item">The item to get the fields from.</param>
    /// <param name="fieldKey">The field key.</param>
    /// <returns>List of field values.</returns>
    public static List<string> GetFieldValues(Item item, string fieldKey)
    {
        return item.FieldValues
            .Where(fv => fv.FieldKey == fieldKey && !fv.IsDeleted)
            .OrderBy(fv => fv.Weight)
            .Select(fv => fv.Value ?? string.Empty)
            .ToList();
    }

    /// <summary>
    /// Sets or updates a field value on an item.
    /// </summary>
    /// <param name="item">The item to update.</param>
    /// <param name="fieldKey">The field key.</param>
    /// <param name="value">The value to set.</param>
    public static void SetFieldValue(Item item, string fieldKey, string? value)
    {
        if (string.IsNullOrEmpty(value))
        {
            RemoveFieldValue(item, fieldKey);
            return;
        }

        var existingField = item.FieldValues.FirstOrDefault(fv => fv.FieldKey == fieldKey && !fv.IsDeleted);
        if (existingField != null)
        {
            existingField.Value = value;
            existingField.UpdatedAt = DateTime.UtcNow;
        }
        else
        {
            item.FieldValues.Add(new FieldValue
            {
                Id = Guid.NewGuid(),
                ItemId = item.Id,
                FieldKey = fieldKey,
                Value = value,
                Weight = 0,
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow,
            });
        }
    }

    /// <summary>
    /// Removes a field value from an item.
    /// </summary>
    /// <param name="item">The item to update.</param>
    /// <param name="fieldKey">The field key to remove.</param>
    public static void RemoveFieldValue(Item item, string fieldKey)
    {
        var existingField = item.FieldValues.FirstOrDefault(fv => fv.FieldKey == fieldKey && !fv.IsDeleted);
        if (existingField != null)
        {
            existingField.IsDeleted = true;
            existingField.UpdatedAt = DateTime.UtcNow;
        }
    }

    /// <summary>
    /// Update the field values for an item.
    /// This follows the same pattern as the browser extension's ItemRepository.updateFieldValues().
    /// We query existing values, compare with new values, and add/update/delete as needed.
    /// </summary>
    /// <param name="context">The database context.</param>
    /// <param name="existingItem">The existing item in the database (tracked by EF).</param>
    /// <param name="newItem">The new item with updated field values (not tracked).</param>
    /// <param name="updateDateTime">The timestamp for updates.</param>
    private static void UpdateFieldValues(AliasClientDbContext context, Item existingItem, Item newItem, DateTime updateDateTime)
    {
        // Get the existing tracked field values from the existingItem (loaded with Include)
        var existingFields = existingItem.FieldValues.Where(fv => !fv.IsDeleted).ToList();

        // Group existing fields by key to support multi-value fields
        var existingByFieldKey = existingFields
            .Where(f => f.FieldKey != null)
            .GroupBy(f => f.FieldKey!)
            .ToDictionary(g => g.Key, g => g.OrderBy(f => f.Weight).ToList());

        var existingByFieldDefId = existingFields
            .Where(f => f.FieldDefinitionId != null)
            .ToDictionary(f => f.FieldDefinitionId!.Value, f => f);

        var processedFieldKeys = new HashSet<string>();
        var processedFieldDefIds = new HashSet<Guid>();

        // Group new fields by key to handle multi-value fields
        var newFieldsByKey = newItem.FieldValues
            .Where(fv => !fv.IsDeleted && fv.FieldKey != null)
            .GroupBy(f => f.FieldKey!)
            .ToDictionary(g => g.Key, g => g.OrderBy(f => f.Weight).ToList());

        // Process new system field values (grouped by key for multi-value support)
        foreach (var kvp in newFieldsByKey)
        {
            var fieldKey = kvp.Key;
            var newValues = kvp.Value;
            processedFieldKeys.Add(fieldKey);

            if (existingByFieldKey.TryGetValue(fieldKey, out var existingValues))
            {
                // Update existing values - match by position (Weight)
                for (int i = 0; i < newValues.Count; i++)
                {
                    var newField = newValues[i];
                    if (i < existingValues.Count)
                    {
                        // Update existing field value
                        var existingField = existingValues[i];
                        if (existingField.Value != newField.Value || existingField.Weight != i)
                        {
                            existingField.Value = newField.Value;
                            existingField.Weight = i;
                            existingField.UpdatedAt = updateDateTime;
                        }
                    }
                    else
                    {
                        // Insert new value (more values than before)
                        context.FieldValues.Add(new FieldValue
                        {
                            Id = Guid.NewGuid(),
                            ItemId = existingItem.Id,
                            FieldKey = fieldKey,
                            FieldDefinitionId = null,
                            Value = newField.Value,
                            Weight = i,
                            CreatedAt = updateDateTime,
                            UpdatedAt = updateDateTime,
                            IsDeleted = false,
                        });
                    }
                }

                // Soft-delete extra existing values (fewer values than before)
                for (int i = newValues.Count; i < existingValues.Count; i++)
                {
                    existingValues[i].IsDeleted = true;
                    existingValues[i].UpdatedAt = updateDateTime;
                }
            }
            else
            {
                // Insert all new values (field didn't exist before)
                for (int i = 0; i < newValues.Count; i++)
                {
                    var newField = newValues[i];
                    context.FieldValues.Add(new FieldValue
                    {
                        Id = Guid.NewGuid(),
                        ItemId = existingItem.Id,
                        FieldKey = fieldKey,
                        FieldDefinitionId = null,
                        Value = newField.Value,
                        Weight = i,
                        CreatedAt = updateDateTime,
                        UpdatedAt = updateDateTime,
                        IsDeleted = false,
                    });
                }
            }
        }

        // Process new custom field values
        foreach (var newField in newItem.FieldValues.Where(fv => !fv.IsDeleted && fv.FieldDefinitionId != null))
        {
            processedFieldDefIds.Add(newField.FieldDefinitionId!.Value);

            if (existingByFieldDefId.TryGetValue(newField.FieldDefinitionId.Value, out var existingField))
            {
                // Update existing field value
                if (existingField.Value != newField.Value || existingField.Weight != newField.Weight)
                {
                    existingField.Value = newField.Value;
                    existingField.Weight = newField.Weight;
                    existingField.UpdatedAt = updateDateTime;
                }

                // Also update the FieldDefinition label if it has changed
                if (newField.FieldDefinition != null && existingField.FieldDefinition != null)
                {
                    if (existingField.FieldDefinition.Label != newField.FieldDefinition.Label)
                    {
                        existingField.FieldDefinition.Label = newField.FieldDefinition.Label;
                        existingField.FieldDefinition.UpdatedAt = updateDateTime;
                    }
                }
            }
            else
            {
                // New custom field - need to add FieldDefinition first if provided
                if (newField.FieldDefinition != null)
                {
                    context.FieldDefinitions.Add(new FieldDefinition
                    {
                        Id = newField.FieldDefinition.Id,
                        FieldType = newField.FieldDefinition.FieldType,
                        Label = newField.FieldDefinition.Label,
                        IsMultiValue = newField.FieldDefinition.IsMultiValue,
                        IsHidden = newField.FieldDefinition.IsHidden,
                        EnableHistory = newField.FieldDefinition.EnableHistory,
                        Weight = newField.FieldDefinition.Weight,
                        ApplicableToTypes = newField.FieldDefinition.ApplicableToTypes,
                        CreatedAt = updateDateTime,
                        UpdatedAt = updateDateTime,
                        IsDeleted = false,
                    });
                }

                // Add the FieldValue
                context.FieldValues.Add(new FieldValue
                {
                    Id = Guid.NewGuid(),
                    ItemId = existingItem.Id,
                    FieldKey = null,
                    FieldDefinitionId = newField.FieldDefinitionId,
                    Value = newField.Value,
                    Weight = newField.Weight,
                    CreatedAt = updateDateTime,
                    UpdatedAt = updateDateTime,
                    IsDeleted = false,
                });
            }
        }

        // Soft-delete removed system fields (all values for a field key)
        foreach (var existingFieldKey in existingByFieldKey.Keys)
        {
            if (!processedFieldKeys.Contains(existingFieldKey))
            {
                foreach (var existingField in existingByFieldKey[existingFieldKey])
                {
                    existingField.IsDeleted = true;
                    existingField.UpdatedAt = updateDateTime;
                }
            }
        }

        // Soft-delete removed custom fields
        foreach (var existingField in existingFields.Where(f => f.FieldDefinitionId != null))
        {
            if (!processedFieldDefIds.Contains(existingField.FieldDefinitionId!.Value))
            {
                existingField.IsDeleted = true;
                existingField.UpdatedAt = updateDateTime;
            }
        }
    }

    /// <summary>
    /// Clears data that is not applicable to the new item type.
    /// Called when an item's type changes (e.g., Login to Note).
    /// </summary>
    /// <param name="context">The database context.</param>
    /// <param name="item">The item to clear data from.</param>
    /// <param name="newType">The new item type.</param>
    /// <param name="updateDateTime">The timestamp for updates.</param>
    private static void ClearInapplicableData(AliasClientDbContext context, Item item, string newType, DateTime updateDateTime)
    {
        // Define field keys by category
        var loginFieldKeys = new[]
        {
            FieldKey.LoginUsername,
            FieldKey.LoginPassword,
            FieldKey.LoginEmail,
            FieldKey.LoginUrl,
        };

        var aliasFieldKeys = new[]
        {
            FieldKey.AliasFirstName,
            FieldKey.AliasLastName,
            FieldKey.AliasGender,
            FieldKey.AliasBirthdate,
        };

        var cardFieldKeys = new[]
        {
            FieldKey.CardNumber,
            FieldKey.CardCardholderName,
            FieldKey.CardExpiryMonth,
            FieldKey.CardExpiryYear,
            FieldKey.CardCvv,
            FieldKey.CardPin,
        };

        // Determine what to clear based on new type
        var fieldKeysToClear = new List<string>();

        switch (newType)
        {
            case ItemType.Note:
                // Note only has notes.content - clear everything else
                fieldKeysToClear.AddRange(loginFieldKeys);
                fieldKeysToClear.AddRange(aliasFieldKeys);
                fieldKeysToClear.AddRange(cardFieldKeys);

                // Clear logo reference for Notes
                item.LogoId = null;

                // Soft-delete all TOTP codes for Notes
                foreach (var totp in item.TotpCodes.Where(t => !t.IsDeleted))
                {
                    totp.IsDeleted = true;
                    totp.UpdatedAt = updateDateTime;
                }

                // Soft-delete all passkeys for Notes
                foreach (var passkey in item.Passkeys.Where(p => !p.IsDeleted))
                {
                    passkey.IsDeleted = true;
                    passkey.UpdatedAt = updateDateTime;
                }

                break;

            case ItemType.CreditCard:
                // Credit card keeps card fields and notes - clear login/alias fields
                fieldKeysToClear.AddRange(loginFieldKeys);
                fieldKeysToClear.AddRange(aliasFieldKeys);

                // Clear logo reference for CreditCards (uses brand detection icon)
                item.LogoId = null;

                // Soft-delete all TOTP codes for CreditCards
                foreach (var totp in item.TotpCodes.Where(t => !t.IsDeleted))
                {
                    totp.IsDeleted = true;
                    totp.UpdatedAt = updateDateTime;
                }

                // Soft-delete all passkeys for CreditCards
                foreach (var passkey in item.Passkeys.Where(p => !p.IsDeleted))
                {
                    passkey.IsDeleted = true;
                    passkey.UpdatedAt = updateDateTime;
                }

                break;

            case ItemType.Login:
            case ItemType.Alias:
                // Login/Alias can have everything except card fields
                fieldKeysToClear.AddRange(cardFieldKeys);
                break;
        }

        // Soft-delete the inapplicable field values
        foreach (var fieldKey in fieldKeysToClear)
        {
            var fieldValue = item.FieldValues.FirstOrDefault(fv => fv.FieldKey == fieldKey && !fv.IsDeleted);
            if (fieldValue != null)
            {
                fieldValue.IsDeleted = true;
                fieldValue.UpdatedAt = updateDateTime;
            }
        }
    }

    /// <summary>
    /// Update the attachments for an item.
    /// </summary>
    /// <param name="context">The database context.</param>
    /// <param name="existingItem">The existing item in the database.</param>
    /// <param name="newItem">The new item with updated attachments.</param>
    /// <param name="updateDateTime">The timestamp for updates.</param>
    private static void UpdateAttachments(DbContext context, Item existingItem, Item newItem, DateTime updateDateTime)
    {
        // Mark existing attachments as deleted if they're not in the new list (excluding already deleted ones)
        var attachmentsToRemove = existingItem.Attachments
            .Where(existingAttachment => !newItem.Attachments.Any(a => a.Id == existingAttachment.Id && !a.IsDeleted))
            .ToList();

        foreach (var attachmentToRemove in attachmentsToRemove)
        {
            attachmentToRemove.IsDeleted = true;
            attachmentToRemove.UpdatedAt = updateDateTime;
        }

        // Process attachments from the new item (excluding deleted ones - they're handled above)
        foreach (var attachment in newItem.Attachments.Where(a => !a.IsDeleted))
        {
            if (attachment.Id != Guid.Empty)
            {
                var existingAttachment = existingItem.Attachments.FirstOrDefault(a => a.Id == attachment.Id);
                if (existingAttachment != null)
                {
                    context.Entry(existingAttachment).CurrentValues.SetValues(attachment);
                    existingAttachment.UpdatedAt = updateDateTime;
                }
            }
            else
            {
                // Create a new attachment entity and add via context to ensure proper tracking
                var newAttachment = new Attachment
                {
                    Id = Guid.NewGuid(),
                    ItemId = existingItem.Id,
                    Filename = attachment.Filename,
                    Blob = attachment.Blob,
                    CreatedAt = updateDateTime,
                    UpdatedAt = updateDateTime,
                    IsDeleted = false,
                };
                context.Add(newAttachment);
            }
        }
    }

    /// <summary>
    /// Update the TOTP codes for an item.
    /// </summary>
    /// <param name="context">The database context.</param>
    /// <param name="existingItem">The existing item in the database.</param>
    /// <param name="newItem">The new item with updated TOTP codes.</param>
    /// <param name="updateDateTime">The timestamp for updates.</param>
    private static void UpdateTotpCodes(DbContext context, Item existingItem, Item newItem, DateTime updateDateTime)
    {
        // Mark existing TOTP codes as deleted if they're not in the new list (excluding already deleted ones)
        var totpCodesToRemove = existingItem.TotpCodes
            .Where(existingTotp => !newItem.TotpCodes.Any(t => t.Id == existingTotp.Id && !t.IsDeleted))
            .ToList();

        foreach (var totpToRemove in totpCodesToRemove)
        {
            totpToRemove.IsDeleted = true;
            totpToRemove.UpdatedAt = updateDateTime;
        }

        // Process TOTP codes from the new item (excluding deleted ones - they're handled above)
        foreach (var totpCode in newItem.TotpCodes.Where(t => !t.IsDeleted))
        {
            if (totpCode.Id != Guid.Empty)
            {
                var existingTotpCode = existingItem.TotpCodes.FirstOrDefault(t => t.Id == totpCode.Id);
                if (existingTotpCode != null)
                {
                    context.Entry(existingTotpCode).CurrentValues.SetValues(totpCode);
                    existingTotpCode.UpdatedAt = updateDateTime;
                }
            }
            else
            {
                // Create a new TOTP code entity and add via context to ensure proper tracking
                var newTotpCode = new TotpCode
                {
                    Id = Guid.NewGuid(),
                    ItemId = existingItem.Id,
                    Name = totpCode.Name,
                    SecretKey = totpCode.SecretKey,
                    CreatedAt = updateDateTime,
                    UpdatedAt = updateDateTime,
                    IsDeleted = false,
                };
                context.Add(newTotpCode);
            }
        }
    }

    /// <summary>
    /// Extract favicon from service URL if available. If successful, links the item to the logo.
    /// Checks for existing logo first to avoid unnecessary API calls (deduplication).
    /// If URL is empty or just the placeholder, clears any existing logo from the item.
    /// </summary>
    /// <param name="item">The Item to extract the favicon for.</param>
    /// <returns>Task.</returns>
    private async Task ExtractFaviconAsync(Item item)
    {
        // Try to extract favicon from service URL
        var url = GetFieldValue(item, FieldKey.LoginUrl);
        if (url != null && !string.IsNullOrEmpty(url) && url != DefaultServiceUrl)
        {
            try
            {
                // Extract and normalize domain for deduplication
                var domain = new Uri(url).Host.ToLowerInvariant();
                if (domain.StartsWith("www."))
                {
                    domain = domain[4..];
                }

                var context = await dbService.GetDbContextAsync();

                // Check if logo already exists for this source (deduplication)
                var existingLogo = await context.Logos.FirstOrDefaultAsync(l => l.Source == domain);

                if (existingLogo != null)
                {
                    // Reuse existing logo - no need to fetch
                    item.LogoId = existingLogo.Id;
                    return;
                }

                // No existing logo - fetch from API
                var apiReturn = await httpClient.GetFromJsonAsync<FaviconExtractModel>($"v1/Favicon/Extract?url={Uri.EscapeDataString(url)}");
                if (apiReturn?.Image is not null)
                {
                    // Create new logo
                    var newLogo = new Logo
                    {
                        Id = Guid.NewGuid(),
                        Source = domain,
                        FileData = apiReturn.Image,
                        MimeType = "image/png",
                        FetchedAt = DateTime.UtcNow,
                        CreatedAt = DateTime.UtcNow,
                        UpdatedAt = DateTime.UtcNow,
                    };
                    context.Logos.Add(newLogo);
                    item.LogoId = newLogo.Id;
                }
            }
            catch
            {
                // Ignore favicon extraction errors
            }
        }
        else
        {
            // URL is empty or just the placeholder - clear any existing logo
            item.LogoId = null;
        }
    }

    /// <summary>
    /// Gets the effective identity generator language to use.
    /// If user has explicitly set a language preference, use that.
    /// Otherwise, intelligently match the UI language to an available identity generator language.
    /// Falls back to "en" if no match is found.
    /// </summary>
    /// <returns>The identity generator language code to use.</returns>
    private async Task<string> GetEffectiveIdentityLanguageAsync()
    {
        var explicitLanguage = dbService.Settings.DefaultIdentityLanguage;

        // If user has explicitly set a language preference, use it
        if (!string.IsNullOrWhiteSpace(explicitLanguage))
        {
            return explicitLanguage;
        }

        // Otherwise, try to match UI language to an identity generator language
        var uiLanguage = dbService.Settings.AppLanguage;
        var mappedLanguage = await jsInteropService.MapUiLanguageToIdentityLanguageAsync(uiLanguage);

        // Return the mapped language, or fall back to "en" if no match found
        return mappedLanguage ?? "en";
    }

    /// <summary>
    /// Track field history for fields with EnableHistory=true.
    /// Compares old values with new values and creates history records.
    ///
    /// This saves the NEW value to history on every change. Since each value is saved
    /// when it's set, we don't need to save the old value (it was already saved when
    /// it was first set). This ensures that during merge conflicts, no values are ever
    /// lost since history records sync independently via LWW and each has a unique ID.
    /// </summary>
    /// <param name="context">The database context.</param>
    /// <param name="existingItem">The existing item in the database.</param>
    /// <param name="newItem">The new item with updated field values.</param>
    /// <param name="updateDateTime">The timestamp for updates.</param>
    /// <returns>Task.</returns>
#pragma warning disable SA1204 // Static members should appear before non-static members
    private static async Task TrackFieldHistoryAsync(AliasClientDbContext context, Item existingItem, Item newItem, DateTime updateDateTime)
#pragma warning restore SA1204
    {
        // Maximum number of history records to keep per field
        const int MaxFieldHistoryRecords = 10;

        // Get the existing tracked field values from the existingItem (loaded with Include)
        var existingFields = existingItem.FieldValues.Where(fv => !fv.IsDeleted).ToList();

        // Group existing fields by key to support multi-value fields
        var existingByFieldKey = existingFields
            .Where(f => f.FieldKey != null)
            .GroupBy(f => f.FieldKey!)
            .ToDictionary(g => g.Key, g => g.OrderBy(f => f.Weight).Select(f => f.Value ?? string.Empty).ToList());

        // Group new fields by key to handle multi-value fields
        var newFieldsByKey = newItem.FieldValues
            .Where(fv => !fv.IsDeleted && fv.FieldKey != null)
            .GroupBy(f => f.FieldKey!)
            .ToDictionary(g => g.Key, g => g.OrderBy(f => f.Weight).Select(f => f.Value ?? string.Empty).ToList());

        foreach (var (fieldKey, newValues) in newFieldsByKey)
        {
            // Check if history tracking is enabled for this field
            var fieldDef = SystemFieldRegistry.GetSystemField(fieldKey);
            if (fieldDef == null || !fieldDef.EnableHistory)
            {
                continue;
            }

            var oldValues = existingByFieldKey.TryGetValue(fieldKey, out var values) ? values : new List<string>();

            // Filter out empty values for comparison
            var filteredNewValues = newValues.Where(v => !string.IsNullOrWhiteSpace(v)).ToList();

            // Check if values have changed
            var valuesChanged = oldValues.Count != filteredNewValues.Count ||
                !oldValues.SequenceEqual(filteredNewValues);

            // Save new values to history when they change (ensures they survive merge conflicts)
            if (valuesChanged && filteredNewValues.Count > 0)
            {
                var valueSnapshot = System.Text.Json.JsonSerializer.Serialize(filteredNewValues);
                var historyRecord = new FieldHistory
                {
                    Id = Guid.NewGuid(),
                    ItemId = existingItem.Id,
                    FieldKey = fieldKey,
                    FieldDefinitionId = null,
                    ValueSnapshot = valueSnapshot,
                    ChangedAt = updateDateTime,
                    CreatedAt = updateDateTime,
                    UpdatedAt = updateDateTime,
                    IsDeleted = false,
                };
                context.FieldHistories.Add(historyRecord);

                // Prune old history records to keep only the most recent
                await PruneFieldHistoryAsync(context, existingItem.Id, fieldKey, MaxFieldHistoryRecords, updateDateTime);
            }
        }
    }

    /// <summary>
    /// Create initial field history records for fields with EnableHistory=true when creating a new item.
    /// This ensures the initial value is captured in history for merge conflict resolution.
    /// </summary>
    /// <param name="context">The database context.</param>
    /// <param name="item">The new item being created.</param>
    /// <param name="createDateTime">The timestamp for creation.</param>
    /// <returns>Task.</returns>
    private static Task CreateInitialFieldHistoryAsync(AliasClientDbContext context, Item item, DateTime createDateTime)
    {
        // Group field values by key to handle multi-value fields
        var fieldsByKey = item.FieldValues
            .Where(fv => !fv.IsDeleted && fv.FieldKey != null)
            .GroupBy(f => f.FieldKey!)
            .ToDictionary(g => g.Key, g => g.OrderBy(f => f.Weight).Select(f => f.Value ?? string.Empty).ToList());

        foreach (var (fieldKey, values) in fieldsByKey)
        {
            // Check if history tracking is enabled for this field
            var fieldDef = SystemFieldRegistry.GetSystemField(fieldKey);
            if (fieldDef == null || !fieldDef.EnableHistory)
            {
                continue;
            }

            // Filter out empty values
            var filteredValues = values.Where(v => !string.IsNullOrWhiteSpace(v)).ToList();

            if (filteredValues.Count > 0)
            {
                var valueSnapshot = System.Text.Json.JsonSerializer.Serialize(filteredValues);
                var historyRecord = new FieldHistory
                {
                    Id = Guid.NewGuid(),
                    ItemId = item.Id,
                    FieldKey = fieldKey,
                    FieldDefinitionId = null,
                    ValueSnapshot = valueSnapshot,
                    ChangedAt = createDateTime,
                    CreatedAt = createDateTime,
                    UpdatedAt = createDateTime,
                    IsDeleted = false,
                };
                context.FieldHistories.Add(historyRecord);
            }
        }

        return Task.CompletedTask;
    }

    /// <summary>
    /// Prune old field history records.
    /// Keeps only the most recent MaxFieldHistoryRecords records.
    /// </summary>
    /// <param name="context">The database context.</param>
    /// <param name="itemId">The item ID.</param>
    /// <param name="fieldKey">The field key.</param>
    /// <param name="maxRecords">Maximum number of records to keep.</param>
    /// <param name="updateDateTime">The timestamp for updates.</param>
    /// <returns>Task.</returns>
    private static async Task PruneFieldHistoryAsync(AliasClientDbContext context, Guid itemId, string fieldKey, int maxRecords, DateTime updateDateTime)
    {
        // Get all history records for this field, ordered by ChangedAt descending
        var historyRecords = await context.FieldHistories
            .Where(fh => fh.ItemId == itemId && fh.FieldKey == fieldKey && !fh.IsDeleted)
            .OrderByDescending(fh => fh.ChangedAt)
            .ToListAsync();

        // If we have more than maxRecords, soft-delete the old ones
        if (historyRecords.Count > maxRecords)
        {
            var recordsToDelete = historyRecords.Skip(maxRecords);
            foreach (var record in recordsToDelete)
            {
                record.IsDeleted = true;
                record.UpdatedAt = updateDateTime;
            }
        }
    }
}
