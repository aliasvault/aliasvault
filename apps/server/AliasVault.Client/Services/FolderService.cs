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
            .OrderBy(f => f.Name)
            .ToListAsync();

        return folders.Select(f => new FolderWithCount
        {
            Id = f.Id,
            Name = f.Name ?? string.Empty,
            ItemCount = f.Items?.Count ?? 0,
        }).ToList();
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
    /// <returns>The created folder ID.</returns>
    public async Task<Guid> CreateAsync(string name, Guid? parentFolderId = null)
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
        dbService.SaveDatabaseInBackground();

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
    /// Delete a folder, moving its items to root (FolderId = null).
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

        // Move all items in this folder to root
        var itemsInFolder = await context.Items
            .Where(i => i.FolderId == folderId && !i.IsDeleted)
            .ToListAsync();

        foreach (var item in itemsInFolder)
        {
            item.FolderId = null;
            item.UpdatedAt = currentDateTime;
        }

        // Soft delete the folder
        folder.IsDeleted = true;
        folder.UpdatedAt = currentDateTime;

        await context.SaveChangesAsync();
        dbService.SaveDatabaseInBackground();

        return true;
    }

    /// <summary>
    /// Delete a folder and all its contents (move items to trash).
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

        // Move all items in this folder to trash
        var itemsInFolder = await context.Items
            .Where(i => i.FolderId == folderId && !i.IsDeleted && i.DeletedAt == null)
            .ToListAsync();

        foreach (var item in itemsInFolder)
        {
            item.DeletedAt = currentDateTime;
            item.UpdatedAt = currentDateTime;
        }

        // Soft delete the folder
        folder.IsDeleted = true;
        folder.UpdatedAt = currentDateTime;

        await context.SaveChangesAsync();
        dbService.SaveDatabaseInBackground();

        return true;
    }
}
