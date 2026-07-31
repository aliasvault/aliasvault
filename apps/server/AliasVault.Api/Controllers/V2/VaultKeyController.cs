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
/// Vault key controller. Serves the encrypted VEK for an authenticated user so a client that has derived the KEK
/// from the unlock secret can decrypt the vault encryption key.
/// </summary>
/// <param name="dbContextFactory">DbContext factory.</param>
/// <param name="userManager">UserManager.</param>
[ApiVersion("2")]
public class VaultKeyController(IAliasServerDbContextFactory dbContextFactory, UserManager<AliasVaultUser> userManager) : AuthenticatedRequestController(userManager)
{
    /// <summary>
    /// Get the encrypted VEK and KEK derivation parameters for the given key type. Always returns HTTP 200;
    /// the payload's VaultKey is null when the user has no such vault key (legacy user, or unknown key type).
    /// </summary>
    /// <param name="type">The unlock method type, e.g. "password" — the <see cref="VaultKeyType"/> member name, case-insensitive.</param>
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

        // A method this build does not know about is "no such key" rather than an error, so a newer client asking
        // for one it supports and this server does not degrades to the same path as a legacy user with no key.
        if (!Enum.TryParse<VaultKeyType>(type, true, out var parsedType) || !Enum.IsDefined(parsedType))
        {
            return Ok(new VaultKeyGetResponse { VaultKey = null });
        }

        var vaultKey = await context.VaultKeys.FirstOrDefaultAsync(x => x.UserId == user.Id && x.Type == parsedType);
        if (vaultKey == null)
        {
            return Ok(new VaultKeyGetResponse { VaultKey = null });
        }

        // The verifier stays server-side; only the KEK derivation inputs are served.
        var (salt, _, encryptionType, encryptionSettings) = VaultKeyMetadata.Parse(vaultKey.Metadata).RequireSrpCredentials();

        return Ok(new VaultKeyGetResponse
        {
            VaultKey = new VaultKeyResponse
            {
                // The wire contract is the lowercased member name; clients match on the literal "password".
                Type = vaultKey.Type.ToString().ToLowerInvariant(),
                EncryptedVek = vaultKey.EncryptedVek,
                Salt = salt,
                EncryptionType = encryptionType,
                EncryptionSettings = encryptionSettings,
            },
        });
    }
}
