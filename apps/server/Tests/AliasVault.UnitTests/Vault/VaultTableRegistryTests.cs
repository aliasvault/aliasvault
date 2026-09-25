//-----------------------------------------------------------------------
// <copyright file="VaultTableRegistryTests.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.UnitTests.Vault;

using AliasClientDb;
using AliasClientDb.Abstracts;
using AliasClientDb.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;

/// <summary>
/// Asserts the generated vault table registry (core/models) matches the EF client datamodel, so a
/// datamodel change that is not applied to both places throws an error here during CI.
/// </summary>
public class VaultTableRegistryTests
{
    private static readonly IModel Model = BuildModel();

    /// <summary>
    /// Every EF entity deriving from SyncableEntity must appear in the registry and vice versa.
    /// </summary>
    [Test]
    public void EverySyncableEntityIsRegistered()
    {
        var efTables = Model.GetEntityTypes().Where(e => typeof(SyncableEntity).IsAssignableFrom(e.ClrType)).Select(e => e.GetTableName()).ToList();
        var registryTables = VaultTableRegistry.Tables.Select(t => t.Name).ToList();
        Assert.That(efTables, Is.EquivalentTo(registryTables));
    }

    /// <summary>
    /// The EF primary key of every registered table must match the registry's key definition.
    /// </summary>
    [Test]
    public void PrimaryKeysMatchTheRegistry()
    {
        foreach (var table in VaultTableRegistry.Tables)
        {
            var pkProperties = FindEntity(table.Name).FindPrimaryKey()!.Properties.Select(p => p.Name).ToList();
            var expected = table.ManifestScoped ? new[] { "ManifestId" }.Concat(table.PrimaryKey).ToList() : table.PrimaryKey.ToList();
            Assert.That(pkProperties, Is.EqualTo(expected).AsCollection, $"{table.Name} primary key drifted from the registry");
        }
    }

    /// <summary>
    /// The registry's manifest-scoped flag must match the entity deriving from ManifestScopedEntity.
    /// </summary>
    [Test]
    public void ManifestScopingMatchesTheRegistry()
    {
        foreach (var table in VaultTableRegistry.Tables)
        {
            var scoped = typeof(ManifestScopedEntity).IsAssignableFrom(FindEntity(table.Name).ClrType);
            Assert.That(scoped, Is.EqualTo(table.ManifestScoped), $"{table.Name} manifest scoping drifted from the registry");
        }
    }

    /// <summary>
    /// Every item-child table must carry its owning item's id: an ItemId property, or for ItemStats
    /// the Id column itself (its Id is the item's id). Tables not flagged as item children must not
    /// silently reference items.
    /// </summary>
    [Test]
    public void ItemChildFlagsMatchTheRegistry()
    {
        foreach (var table in VaultTableRegistry.Tables)
        {
            var hasItemReference = table.Name == "ItemStats" || FindEntity(table.Name).FindProperty("ItemId") != null;
            Assert.That(hasItemReference, Is.EqualTo(table.ItemChild), $"{table.Name} item-child flag drifted from the registry");
        }
    }

    /// <summary>
    /// Build the EF model without opening a database connection.
    /// </summary>
    /// <returns>The EF model of the client database.</returns>
    private static IModel BuildModel()
    {
        var options = new DbContextOptionsBuilder<AliasClientDbContext>().UseSqlite("Data Source=:memory:").Options;
        using var context = new AliasClientDbContext(options);
        return context.Model;
    }

    /// <summary>
    /// Find the EF entity type mapped to a table name.
    /// </summary>
    /// <param name="tableName">The SQLite table name.</param>
    /// <returns>The entity type.</returns>
    private static IEntityType FindEntity(string tableName)
    {
        var entity = Model.GetEntityTypes().SingleOrDefault(e => e.GetTableName() == tableName);
        Assert.That(entity, Is.Not.Null, $"registry table {tableName} has no EF entity");
        return entity!;
    }
}
