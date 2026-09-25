//-----------------------------------------------------------------------
// <copyright file="ManifestStamper.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Services.Database;

using AliasClientDb;
using AliasClientDb.Abstracts;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;

/// <summary>
/// Stamps every new row with the manifest it belongs to before it is saved. Row identity is (ManifestId, Id) and the
/// codec refuses to write a row that names no manifest, so nothing may reach the database unstamped.
/// </summary>
internal static class ManifestStamper
{
    /// <summary>
    /// Stamp every added row that carries no manifest yet.
    /// </summary>
    /// <param name="context">The context about to save.</param>
    /// <param name="personalManifestId">The caller's own manifest, the default scope.</param>
    public static void Stamp(DbContext context, Guid personalManifestId)
    {
        context.ChangeTracker.DetectChanges();
        var unstamped = context.ChangeTracker.Entries<ManifestScopedEntity>().Where(entry => entry.State == EntityState.Added && entry.Entity.ManifestId == Guid.Empty).ToList();
        if (unstamped.Count == 0)
        {
            return;
        }

        var resolver = new ScopeResolver(context, personalManifestId);

        // Containers first, so the rows inside them can look their scope up.
        foreach (var entry in unstamped.Where(entry => entry.Entity is Folder))
        {
            Apply(entry, resolver.ForFolder((Folder)entry.Entity));
        }

        foreach (var entry in unstamped.Where(entry => entry.Entity is Item))
        {
            Apply(entry, resolver.ForItem((Item)entry.Entity));
        }

        foreach (var entry in unstamped)
        {
            var itemId = ItemIdOf(entry.Entity);
            if (itemId is { } id)
            {
                Apply(entry, resolver.OfItem(id));
            }
        }

        // Rows that other rows point at follow the row pointing at them.
        var referenced = ReferencedScopes(context);
        foreach (var entry in unstamped.Where(entry => entry.Entity.ManifestId == Guid.Empty))
        {
            Apply(entry, referenced.TryGetValue(ReferenceKey(entry.Entity), out var scope) ? scope : personalManifestId);
        }
    }

    /// <summary>
    /// Set the stamp on an added entry.
    /// </summary>
    /// <param name="entry">The entry.</param>
    /// <param name="manifestId">The manifest.</param>
    private static void Apply(EntityEntry<ManifestScopedEntity> entry, Guid manifestId)
    {
        if (entry.Entity.ManifestId == Guid.Empty)
        {
            entry.Property(nameof(ManifestScopedEntity.ManifestId)).CurrentValue = manifestId;
        }
    }

    /// <summary>
    /// The item a child row belongs to, or null when the row is not an item child.
    /// </summary>
    /// <param name="entity">The entity.</param>
    /// <returns>The item id.</returns>
    private static Guid? ItemIdOf(ManifestScopedEntity entity)
    {
        return entity switch
        {
            FieldValue row => row.ItemId,
            FieldHistory row => row.ItemId,
            Attachment row => row.ItemId,
            Passkey row => row.ItemId,
            TotpCode row => row.ItemId,
            ItemTag row => row.ItemId,
            ItemStat row => row.Id,
            _ => null,
        };
    }

    /// <summary>
    /// The lookup key a referenced row is found under.
    /// </summary>
    /// <param name="entity">The entity.</param>
    /// <returns>The key.</returns>
    private static (Type Type, Guid Id) ReferenceKey(ManifestScopedEntity entity)
    {
        return entity switch
        {
            Tag row => (typeof(Tag), row.Id),
            FieldDefinition row => (typeof(FieldDefinition), row.Id),
            Logo row => (typeof(Logo), row.Id),
            _ => (entity.GetType(), Guid.Empty),
        };
    }

    /// <summary>
    /// The manifest every tag, field definition and logo is referenced from by a tracked, stamped row.
    /// </summary>
    /// <param name="context">The context.</param>
    /// <returns>Reference key to manifest.</returns>
    private static Dictionary<(Type Type, Guid Id), Guid> ReferencedScopes(DbContext context)
    {
        var scopes = new Dictionary<(Type Type, Guid Id), Guid>();
        foreach (var entry in context.ChangeTracker.Entries<ManifestScopedEntity>().Where(entry => entry.State is EntityState.Added or EntityState.Modified && entry.Entity.ManifestId != Guid.Empty))
        {
            switch (entry.Entity)
            {
                case ItemTag row:
                    scopes.TryAdd((typeof(Tag), row.TagId), row.ManifestId);
                    break;
                case FieldValue { FieldDefinitionId: { } definitionId } row:
                    scopes.TryAdd((typeof(FieldDefinition), definitionId), row.ManifestId);
                    break;
                case FieldHistory { FieldDefinitionId: { } definitionId } row:
                    scopes.TryAdd((typeof(FieldDefinition), definitionId), row.ManifestId);
                    break;
                case Item { LogoId: { } logoId } row:
                    scopes.TryAdd((typeof(Logo), logoId), row.ManifestId);
                    break;
            }
        }

        return scopes;
    }

    /// <summary>
    /// Resolves the manifest of folders and items, from the change tracker first and the database second.
    /// </summary>
    private sealed class ScopeResolver(DbContext context, Guid personalManifestId)
    {
        private readonly Dictionary<Guid, Guid> _folderScopes = [];
        private readonly Dictionary<Guid, Guid> _itemScopes = [];

        /// <summary>
        /// The manifest a folder belongs to: its parent's, or personal at the root.
        /// </summary>
        /// <param name="folder">The folder.</param>
        /// <returns>The manifest.</returns>
        public Guid ForFolder(Folder folder)
        {
            var scope = folder.ParentFolderId is { } parentId ? OfFolder(parentId) : personalManifestId;
            _folderScopes[folder.Id] = scope;
            return scope;
        }

        /// <summary>
        /// The manifest an item belongs to: its folder's, or personal without one.
        /// </summary>
        /// <param name="item">The item.</param>
        /// <returns>The manifest.</returns>
        public Guid ForItem(Item item)
        {
            var scope = item.FolderId is { } folderId ? OfFolder(folderId) : personalManifestId;
            _itemScopes[item.Id] = scope;
            return scope;
        }

        /// <summary>
        /// The manifest of an existing item.
        /// </summary>
        /// <param name="itemId">The item id.</param>
        /// <returns>The manifest, personal when the item is unknown.</returns>
        public Guid OfItem(Guid itemId)
        {
            if (_itemScopes.TryGetValue(itemId, out var known))
            {
                return known;
            }

            var tracked = context.ChangeTracker.Entries<Item>().FirstOrDefault(entry => entry.Entity.Id == itemId && entry.Entity.ManifestId != Guid.Empty)?.Entity.ManifestId;
            var scope = tracked ?? context.Set<Item>().AsNoTracking().Where(item => item.Id == itemId).Select(item => item.ManifestId).FirstOrDefault();
            if (scope == Guid.Empty)
            {
                scope = personalManifestId;
            }

            _itemScopes[itemId] = scope;
            return scope;
        }

        /// <summary>
        /// The manifest of an existing folder.
        /// </summary>
        /// <param name="folderId">The folder id.</param>
        /// <returns>The manifest, personal when the folder is unknown.</returns>
        private Guid OfFolder(Guid folderId)
        {
            if (_folderScopes.TryGetValue(folderId, out var known))
            {
                return known;
            }

            var trackedEntry = context.ChangeTracker.Entries<Folder>().FirstOrDefault(entry => entry.Entity.Id == folderId);
            Guid scope;
            if (trackedEntry is not null && trackedEntry.Entity.ManifestId != Guid.Empty)
            {
                scope = trackedEntry.Entity.ManifestId;
            }
            else if (trackedEntry is not null)
            {
                // An added parent that is not stamped yet: resolve it through its own parent chain.
                _folderScopes[folderId] = personalManifestId;
                scope = ForFolder(trackedEntry.Entity);
            }
            else
            {
                scope = context.Set<Folder>().AsNoTracking().Where(folder => folder.Id == folderId).Select(folder => folder.ManifestId).FirstOrDefault();
                if (scope == Guid.Empty)
                {
                    scope = personalManifestId;
                }
            }

            _folderScopes[folderId] = scope;
            return scope;
        }
    }
}
