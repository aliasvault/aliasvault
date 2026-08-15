//-----------------------------------------------------------------------
// <copyright file="TestUserSeeder.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.IntegrationTests;

using AliasServerDb;

/// <summary>
/// Helper that seeds a test user with their personal group, owner membership, vault manifest and primary delivery key.
/// </summary>
public static class TestUserSeeder
{
    /// <summary>
    /// Creates and persists a user together with their personal group, owner membership, vault manifest and primary delivery key.
    /// </summary>
    /// <param name="dbContext">The database context to create the entities in.</param>
    /// <param name="userName">The username, also used as the personal group name.</param>
    /// <param name="email">The user's email address.</param>
    /// <param name="publicKey">The public key to publish as the manifest's primary delivery key.</param>
    /// <param name="configureUser">Optional callback to set additional user properties (e.g. activity dates) before saving.</param>
    /// <param name="configureGroup">Optional callback to set additional group properties (e.g. email limits) before saving.</param>
    /// <returns>The created entity graph.</returns>
    public static async Task<(AliasVaultUser User, Group PersonalGroup, VaultManifest Manifest, VaultManifestDeliveryKey DeliveryKey)> CreateTestUserAsync(
        AliasServerDbContext dbContext,
        string userName,
        string email,
        string publicKey = "test-encryption-key",
        Action<AliasVaultUser>? configureUser = null,
        Action<Group>? configureGroup = null)
    {
        var now = DateTime.UtcNow;

        // Every user requires a personal group that owns their vault content and email claims.
        var group = new Group { Id = Guid.NewGuid(), Name = userName, Type = GroupType.Personal, CreatedAt = now, UpdatedAt = now };
        configureGroup?.Invoke(group);
        dbContext.Groups.Add(group);
        await dbContext.SaveChangesAsync();

        var user = new AliasVaultUser { UserName = userName, Email = email, PersonalGroupId = group.Id };
        configureUser?.Invoke(user);
        dbContext.AliasVaultUsers.Add(user);
        await dbContext.SaveChangesAsync();

        dbContext.GroupMembers.Add(new GroupMember { Id = Guid.NewGuid(), GroupId = group.Id, UserId = user.Id, Role = GroupRole.Owner, CreatedAt = now, UpdatedAt = now });

        // The personal group owns a single manifest; email claims link to it and delivery keys scope to it.
        var manifest = new VaultManifest { ManifestId = Guid.NewGuid(), OwnerGroupId = group.Id, StorageFormat = "sqlite-blob", RevisionNumber = 1, CreatedAt = now, UpdatedAt = now };
        dbContext.VaultManifests.Add(manifest);

        // At most one primary delivery key exists per manifest (unique filtered index).
        var deliveryKey = new VaultManifestDeliveryKey { Id = Guid.NewGuid(), VaultManifestId = manifest.ManifestId, PublicKey = publicKey, IsPrimary = true, CreatedAt = now, UpdatedAt = now };
        dbContext.VaultManifestDeliveryKeys.Add(deliveryKey);
        await dbContext.SaveChangesAsync();

        return (user, group, manifest, deliveryKey);
    }

    /// <summary>
    /// Creates an email claim linked to the given manifest. The claim is not yet added to the database context.
    /// </summary>
    /// <param name="vaultManifestId">The manifest that claims the alias.</param>
    /// <param name="address">The full email address; the local and domain parts are derived from it.</param>
    /// <param name="disabled">Whether the claim is disabled, i.e. the manifest no longer carries the alias.</param>
    /// <param name="createdAt">Optional created/updated timestamp; defaults to now.</param>
    /// <returns>The new email claim carrying a single link to the manifest.</returns>
    public static EmailClaim CreateEmailClaim(Guid vaultManifestId, string address, bool disabled = false, DateTime? createdAt = null)
    {
        var timestamp = createdAt ?? DateTime.UtcNow;
        var addressParts = address.Split('@');
        return new EmailClaim
        {
            Address = address,
            AddressLocal = addressParts[0],
            AddressDomain = addressParts[1],
            CreatedAt = timestamp,
            UpdatedAt = timestamp,
            Links = [new EmailClaimLink { VaultManifestId = vaultManifestId, State = disabled ? EmailClaimLinkState.Removed : EmailClaimLinkState.Active }],
        };
    }
}
