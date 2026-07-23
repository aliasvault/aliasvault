//-----------------------------------------------------------------------
// <copyright file="StatusController.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Controllers.V2;

using AliasServerDb;
using AliasVault.Api.Controllers.Abstracts;
using AliasVault.Api.Headers;
using AliasVault.Api.Helpers;
using AliasVault.Shared.Core;
using AliasVault.Shared.Models.Enums;
using AliasVault.Shared.Models.WebApi;
using AliasVault.Shared.Models.WebApi.V2.Vault;
using Asp.Versioning;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using StatusModels = AliasVault.Shared.Models.WebApi.V2.Status;

/// <summary>
/// Generic status controller. Serves the single <c>GET /v2/Status</c> endpoint that a client polls to get
/// full sync status in one call including session validity, manifest and bucket revisions etc.
/// </summary>
/// <param name="dbContextFactory">DbContext factory.</param>
/// <param name="userManager">UserManager.</param>
[ApiVersion("2")]
public class StatusController(IAliasServerDbContextFactory dbContextFactory, UserManager<AliasVaultUser> userManager) : AuthenticatedRequestController(userManager)
{
    /// <summary>
    /// Status endpoint called by the client to get the full sync status in one call.
    /// </summary>
    /// <param name="clientHeader">Client header used for version-compatibility checks.</param>
    /// <returns>The combined status response, or 401 when the caller is not authenticated.</returns>
    [HttpGet]
    public async Task<IActionResult> Status([FromHeader(Name = "X-AliasVault-Client")] string? clientHeader)
    {
        var user = await GetUserManager().GetUserAsync(User);
        if (user == null)
        {
            return Unauthorized();
        }

        if (user.Blocked)
        {
            return Unauthorized(ApiErrorCodeHelper.CreateErrorResponse(ApiErrorCode.ACCOUNT_BLOCKED, 401));
        }

        await using var context = await dbContextFactory.CreateDbContextAsync();

        // Manifest revisions and migration status are built via the shared helper.
        var manifestRevisions = await VaultStatusHelper.GetManifestRevisionsAsync(context, user.Id);
        var isMigrated = await VaultStatusHelper.IsUserMigratedAsync(context, user.Id);

        // Latest revision per bucket kind.
        var bucketRevisions = await context.VaultDataBuckets
            .Where(x => x.OwnerUserId == user.Id)
            .GroupBy(x => x.Category)
            .Select(g => new BucketRevision { Category = g.Key, Revision = g.Max(b => b.RevisionNumber) })
            .ToListAsync();

        // Current SRP salt: lives on the password VaultKey for v2 migrated users, on the root manifest for legacy users.
        var encryptionSettings = AuthHelper.GetUserLatestVaultEncryptionSettings(user);

        // Check client version compatibility if the header is provided.
        var clientSupported = false;
        var clientInfo = ClientHeaderInfo.Parse(clientHeader);
        if (!string.IsNullOrEmpty(clientInfo.ClientVersion)
            && AppInfo.MinimumClientVersions.TryGetValue(clientInfo.ClientName, out var minimumVersion))
        {
            var meetsMinimum = VersionHelper.IsVersionEqualOrNewer(clientInfo.ClientVersion, minimumVersion);
            var isBlocked = VersionHelper.IsVersionBlocked(clientInfo.ClientName, clientInfo.ClientVersion, AppInfo.UnsupportedClientVersions);
            clientSupported = meetsMinimum && !isBlocked;
        }

        return Ok(new StatusModels.StatusResponse
        {
            ClientVersionSupported = clientSupported,
            ServerVersion = AppInfo.GetFullVersion(),
            SrpSalt = encryptionSettings.Salt,
            IsMigrated = isMigrated,
            ManifestRevisions = manifestRevisions,
            BucketRevisions = bucketRevisions,
        });
    }
}
