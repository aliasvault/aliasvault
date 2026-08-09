//-----------------------------------------------------------------------
// <copyright file="VaultKeyController.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Controllers.V2;

using AliasServerDb;
using AliasVault.Api.Controllers.Abstracts;
using AliasVault.Api.Helpers;
using AliasVault.Shared.Models.Enums;
using AliasVault.Shared.Models.WebApi.V2.Auth;
using Asp.Versioning;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

/// <summary>
/// Vault key controller. Serves the encrypted Account Key for an authenticated user.
/// </summary>
/// <param name="dbContextFactory">DbContext factory.</param>
/// <param name="userManager">UserManager.</param>
[ApiVersion("2")]
public class VaultKeyController(IAliasServerDbContextFactory dbContextFactory, UserManager<AliasVaultUser> userManager) : AuthenticatedRequestController(userManager)
{
    /// <summary>
    /// Get the encrypted Account Key and KEK derivation parameters for the given unlock method.
    /// </summary>
    /// <param name="type">The unlock method type, e.g. "password".</param>
    /// <returns>The vault key envelope DTO.</returns>
    [HttpGet("{type}")]
    public async Task<IActionResult> Get(string type)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        var user = await GetCurrentUserAsync();
        if (user == null)
        {
            return Unauthorized();
        }

        // Check if the unlock method type is valid.
        if (!UnlockMethodTypes.TryParse(type?.ToLowerInvariant(), out var parsedType))
        {
            return Ok(new VaultKeyGetResponse { VaultKey = null });
        }

        var unlockKey = await context.UserUnlockKeys.FirstOrDefaultAsync(x => x.UserId == user.Id && x.Type == parsedType);
        if (unlockKey == null)
        {
            return Ok(new VaultKeyGetResponse { VaultKey = null });
        }

        // Get the encrypted VEK and account keypair.
        var personalManifestId = await GroupHelper.GetPersonalManifestIdAsync(context, user.PersonalGroupId);
        var encryptedVek = personalManifestId is null ? null : await context.VaultManifestAccessKeys
            .Where(x => x.UserId == user.Id && x.Type == ManifestKeyType.AccountKey && x.VaultManifestId == personalManifestId.Value)
            .Select(x => x.EncryptedVek)
            .FirstOrDefaultAsync();
        var accountKeypair = await context.UserGrantKeys
            .Where(x => x.UserId == user.Id && x.IsPrimary)
            .Select(x => new { x.PublicKey, x.EncryptedPrivateKey })
            .FirstOrDefaultAsync();

        // Get the KEK derivation parameters.
        var (salt, _, encryptionType, encryptionSettings) = VaultKeyMetadata.Parse(unlockKey.Metadata).RequireSrpCredentials();

        return Ok(new VaultKeyGetResponse
        {
            VaultKey = new VaultKeyResponse
            {
                Type = UnlockMethodTypes.ToToken(unlockKey.Type),
                EncryptedAccountKey = unlockKey.EncryptedAccountKey,
                EncryptedVek = encryptedVek,
                AccountPublicKey = accountKeypair?.PublicKey,
                EncryptedAccountPrivateKey = accountKeypair?.EncryptedPrivateKey,
                Salt = salt,
                EncryptionType = encryptionType,
                EncryptionSettings = encryptionSettings,
            },
        });
    }
}
