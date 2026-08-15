//-----------------------------------------------------------------------
// <copyright file="EmailKeyTable.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Helpers;

using AliasServerDb;
using AliasVault.Shared.Models.WebApi.V2.Email;
using Microsoft.EntityFrameworkCore;

/// <summary>
/// The public keys a caller can decrypt mail with, in specific order so other items in the response can refer to public keys by stable index.
/// </summary>
public sealed class EmailKeyTable
{
    private readonly Dictionary<Guid, int> indexByKeyId;

    private EmailKeyTable(Dictionary<Guid, int> indexByKeyId, List<string> publicKeys)
    {
        this.indexByKeyId = indexByKeyId;
        PublicKeys = publicKeys;
    }

    /// <summary>
    /// Gets the public keys in index order, to be sent as the response-level key table.
    /// </summary>
    public List<string> PublicKeys { get; }

    /// <summary>
    /// Build the key table for the encryption keys the caller holds the private half of.
    /// </summary>
    /// <param name="context">Database context.</param>
    /// <param name="decryptableKeyIds">The encryption key ids resolved by <see cref="EmailAccessHelper.ResolveDecryptableKeyIdsAsync"/>.</param>
    /// <returns>The key table.</returns>
    public static async Task<EmailKeyTable> BuildAsync(AliasServerDbContext context, List<Guid> decryptableKeyIds)
    {
        var keys = await context.VaultManifestDeliveryKeys
            .Where(k => decryptableKeyIds.Contains(k.Id))
            .Select(k => new { k.Id, k.PublicKey })
            .ToListAsync();

        return Create(keys.Select(k => (k.Id, k.PublicKey)));
    }

    /// <summary>
    /// Build the key table from keys that are already loaded.
    /// </summary>
    /// <param name="keys">The encryption keys, duplicates allowed.</param>
    /// <returns>The key table.</returns>
    public static EmailKeyTable Create(IEnumerable<(Guid Id, string PublicKey)> keys)
    {
        // Order by id so the table is deterministic.
        var ordered = keys.DistinctBy(k => k.Id).OrderBy(k => k.Id).ToList();

        var indexByKeyId = new Dictionary<Guid, int>(ordered.Count);
        for (var i = 0; i < ordered.Count; i++)
        {
            indexByKeyId[ordered[i].Id] = i;
        }

        return new EmailKeyTable(indexByKeyId, ordered.ConvertAll(k => k.PublicKey));
    }

    /// <summary>
    /// Convert the raw decryption keys of a single email into API models that reference this table by index.
    /// </summary>
    /// <param name="decryptionKeys">The decryption keys of one email, already filtered to the keys the caller holds.</param>
    /// <returns>The decryption key API models, ordered by key index.</returns>
    public List<EmailDecryptionKeyApiModel> ToApiModels(IEnumerable<(Guid VaultManifestDeliveryKeyId, string EncryptedSymmetricKey)> decryptionKeys)
    {
        return decryptionKeys
            .Where(d => indexByKeyId.ContainsKey(d.VaultManifestDeliveryKeyId))
            .Select(d => new EmailDecryptionKeyApiModel { KeyIndex = indexByKeyId[d.VaultManifestDeliveryKeyId], EncryptedSymmetricKey = d.EncryptedSymmetricKey })
            .OrderBy(d => d.KeyIndex)
            .ToList();
    }
}
