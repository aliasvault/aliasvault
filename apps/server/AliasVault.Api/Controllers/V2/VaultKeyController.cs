//-----------------------------------------------------------------------
// <copyright file="VaultKeyController.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Controllers.V2;

using AliasServerDb;
using AliasVault.Api.Controllers.Abstracts;
using AliasVault.Shared.Models.WebApi.V2.Auth;
using Asp.Versioning;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

/// <summary>
/// Vault key controller. Serves the wrapped VEK for an authenticated user so a client that has derived the KEK
/// from the unlock secret can unwrap the vault encryption key.
/// </summary>
/// <param name="dbContextFactory">DbContext factory.</param>
/// <param name="userManager">UserManager.</param>
[ApiVersion("2")]
public class VaultKeyController(IAliasServerDbContextFactory dbContextFactory, UserManager<AliasVaultUser> userManager) : AuthenticatedRequestController(userManager)
{
    /// <summary>
    /// Get the wrapped VEK and KEK derivation parameters for the given key type. Always returns HTTP 200;
    /// the payload's VaultKey is null when the user has no such vault key (legacy user, or unknown key type).
    /// </summary>
    /// <param name="keyType">The unlock method type, e.g. "password".</param>
    /// <returns>The vault key envelope DTO.</returns>
    [HttpGet("{keyType}")]
    public async Task<IActionResult> Get(string keyType)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        var user = await GetCurrentUserAsync();
        if (user == null)
        {
            return Unauthorized();
        }

        var vaultKey = await context.VaultKeys.FirstOrDefaultAsync(x => x.UserId == user.Id && x.KeyType == keyType);
        if (vaultKey == null)
        {
            return Ok(new VaultKeyGetResponse { VaultKey = null });
        }

        return Ok(new VaultKeyGetResponse
        {
            VaultKey = new VaultKeyResponse
            {
                KeyType = vaultKey.KeyType,
                WrappedVek = vaultKey.WrappedVek,
                Salt = vaultKey.Salt,
                EncryptionType = vaultKey.EncryptionType,
                EncryptionSettings = vaultKey.EncryptionSettings,
            },
        });
    }
}
