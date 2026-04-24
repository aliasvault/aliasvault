//-----------------------------------------------------------------------
// <copyright file="FolderService.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Services;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using AliasClientDb;
using AliasVault.Client.Main.Models;
using AliasVault.Client.Main.Utilities;
using Microsoft.EntityFrameworkCore;

/// <summary>
/// Service class for Folder operations.
/// All mutations use background sync to avoid blocking the UI.
/// </summary>
public sealed class FolderService(DbService dbService)
{
    /// <summary>
    /// Get all folders with item counts.
    /// </summary>
    /// <returns>List of FolderWithCount objects.</returns>
    public async Task<List<FolderWithCount>> GetAllWithCountsAsync()
    {
        var context = await dbService.GetDbContextAsync();

        var folders = await context.Folders
            .Where(f => !f.IsDeleted)
            .Include(f => f.Items.Where(i => !i.IsDeleted && i.DeletedAt == null))
            .ToListAsync();

        // Build a map of direct item counts per folder
        var directCounts = new Dictionary<Guid, int>();
        foreach (var folder in folders)
        {
            directCounts[folder.Id] = folder.Items?.Count ?? 0;
        }

        // Calculate recursive counts (includes subfolders)
        var folderWithCounts = folders.Select(f => new FolderWithCount
        {
            Id = f.Id,
            Name = f.Name ?? string.Empty,
            ParentFolderId = f.ParentFolderId,
            Weight = f.Weight,
            ItemCount = GetRecursiveItemCount(f.Id, folders, directCounts),
        }).ToList();

        // Sort by weight, then by name (case-insensitive)
        folderWithCounts = folderWithCounts
            .OrderBy(f => f.Weight)
            .ThenBy(f => f.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();

        return folderWithCounts;
    }

    /// <summary>
    /// Get folders filtered by parent folder ID with recursive item counts.
    /// </summary>
    /// <param name="parentFolderId">Parent folder ID (null for root folders).</param>
    /// <returns>List of FolderWithCount objects.</returns>
    public async Task<List<FolderWithCount>> GetByParentWithCountsAsync(Guid? parentFolderId)
    {
        var allFolders = await GetAllWithCountsAsync();
        return allFolders.Where(f => f.ParentFolderId == parentFolderId).ToList();
    }

    /// <summary>
    /// Get a folder by ID.
    /// </summary>
    /// <param name="folderId">The folder ID.</param>
    /// <returns>The Folder entity or null.</returns>
    public async Task<Folder?> GetByIdAsync(Guid folderId)
    {
        var context = await dbService.GetDbContextAsync();

        return await context.Folders
            .Where(f => f.Id == folderId && !f.IsDeleted)
            .FirstOrDefaultAsync();
    }

    /// <summary>
    /// Create a new folder. Syncs to server in background without blocking UI.
    /// </summary>
    /// <param name="name">The folder name.</param>
    /// <param name="parentFolderId">Optional parent folder ID.</param>
    /// <param name="syncToServer">Whether to trigger a background sync to the server. Set to false when
    /// the caller will batch multiple mutations and perform a single sync afterwards (e.g. bulk import).</param>
    /// <returns>The created folder ID.</returns>
    public async Task<Guid> CreateAsync(string name, Guid? parentFolderId = null, bool syncToServer = true)
    {
        var context = await dbService.GetDbContextAsync();

        var currentDateTime = DateTime.UtcNow;
        var folder = new Folder
        {
            Id = Guid.NewGuid(),
            Name = name,
            ParentFolderId = parentFolderId,
            Weight = 0,
            CreatedAt = currentDateTime,
            UpdatedAt = currentDateTime,
        };

        context.Folders.Add(folder);
        await context.SaveChangesAsync();

        if (syncToServer)
        {
            dbService.SaveDatabaseInBackground();
        }

        return folder.Id;
    }

    /// <summary>
    /// Update a folder's name. Syncs to server in background without blocking UI.
    /// </summary>
    /// <param name="folderId">The folder ID.</param>
    /// <param name="name">The new folder name.</param>
    /// <returns>True if folder was found and updated.</returns>
    public async Task<bool> UpdateAsync(Guid folderId, string name)
    {
        var context = await dbService.GetDbContextAsync();

        var folder = await context.Folders
            .Where(f => f.Id == folderId && !f.IsDeleted)
            .FirstOrDefaultAsync();

        if (folder == null)
        {
            return false;
        }

        folder.Name = name;
        folder.UpdatedAt = DateTime.UtcNow;

        await context.SaveChangesAsync();
        dbService.SaveDatabaseInBackground();

        return true;
    }

    /// <summary>
    /// Delete a folder, moving its items and subfolders to parent (or root if no parent).
    /// Syncs to server in background without blocking UI.
    /// </summary>
    /// <param name="folderId">The folder ID.</param>
    /// <returns>True if folder was found and deleted.</returns>
    public async Task<bool> DeleteAsync(Guid folderId)
    {
        var context = await dbService.GetDbContextAsync();

        var folder = await context.Folders
            .Where(f => f.Id == folderId && !f.IsDeleted)
            .FirstOrDefaultAsync();

        if (folder == null)
        {
            return false;
        }

        var currentDateTime = DateTime.UtcNow;

        // Move all items in this folder to parent (or root if no parent)
        var itemsInFolder = await context.Items
            .Where(i => i.FolderId == folderId && !i.IsDeleted)
            .ToListAsync();

        foreach (var item in itemsInFolder)
        {
            item.FolderId = folder.ParentFolderId;
            item.UpdatedAt = currentDateTime;
        }

        // Move all subfolders to parent (or root if no parent)
        var subfolders = await context.Folders
            .Where(f => f.ParentFolderId == folderId && !f.IsDeleted)
            .ToListAsync();

        foreach (var subfolder in subfolders)
        {
            subfolder.ParentFolderId = folder.ParentFolderId;
            subfolder.UpdatedAt = currentDateTime;
        }

        // Soft delete the folder
        folder.IsDeleted = true;
        folder.UpdatedAt = currentDateTime;

        await context.SaveChangesAsync();
        dbService.SaveDatabaseInBackground();

        return true;
    }

    /// <summary>
    /// Delete a folder and all its contents recursively (move items to trash, delete subfolders).
    /// Syncs to server in background without blocking UI.
    /// </summary>
    /// <param name="folderId">The folder ID.</param>
    /// <returns>True if folder was found and deleted.</returns>
    public async Task<bool> DeleteWithContentsAsync(Guid folderId)
    {
        var context = await dbService.GetDbContextAsync();

        var folder = await context.Folders
            .Where(f => f.Id == folderId && !f.IsDeleted)
            .FirstOrDefaultAsync();

        if (folder == null)
        {
            return false;
        }

        var currentDateTime = DateTime.UtcNow;

        // Get all descendant folders
        var allFolders = await context.Folders
            .Where(f => !f.IsDeleted)
            .ToListAsync();

        var descendantIds = FolderTreeUtilities.GetDescendantFolderIds(folderId, allFolders);
        var allFolderIdsToDelete = new List<Guid> { folderId };
        allFolderIdsToDelete.AddRange(descendantIds);

        // Move all items in this folder and all subfolders to trash
        var itemsInFolders = await context.Items
            .Where(i => allFolderIdsToDelete.Contains(i.FolderId!.Value) && !i.IsDeleted && i.DeletedAt == null)
            .ToListAsync();

        foreach (var item in itemsInFolders)
        {
            item.DeletedAt = currentDateTime;
            item.FolderId = null;
            item.UpdatedAt = currentDateTime;
        }

        // Soft delete the folder and all subfolders
        var foldersToDelete = await context.Folders
            .Where(f => allFolderIdsToDelete.Contains(f.Id) && !f.IsDeleted)
            .ToListAsync();

        foreach (var folderToDelete in foldersToDelete)
        {
            folderToDelete.IsDeleted = true;
            folderToDelete.UpdatedAt = currentDateTime;
        }

        await context.SaveChangesAsync();
        dbService.SaveDatabaseInBackground();

        return true;
    }

    /// <summary>
    /// Calculate recursive item count for a folder.
    /// </summary>
    private static int GetRecursiveItemCount(Guid folderId, List<Folder> allFolders, Dictionary<Guid, int> directCounts)
    {
        // Start with direct items in this folder
        int count = directCounts.TryGetValue(folderId, out var directCount) ? directCount : 0;

        // Add items from all descendant folders
        var descendantIds = FolderTreeUtilities.GetDescendantFolderIds(folderId, allFolders);
        foreach (var descendantId in descendantIds)
        {
            count += directCounts.TryGetValue(descendantId, out var descendantCount) ? descendantCount : 0;
        }

        return count;
    }
}
