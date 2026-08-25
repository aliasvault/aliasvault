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
using AliasVault.Api.Services;
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
/// <param name="capabilityService">Resolves which capabilities the caller may use.</param>
[ApiVersion("2")]
public class StatusController(IAliasServerDbContextFactory dbContextFactory, UserManager<AliasVaultUser> userManager, CapabilityService capabilityService) : AuthenticatedRequestController(userManager)
{
    /// <summary>
    /// Status endpoint called by the client to get the full sync status in one call.
    /// </summary>
    /// <returns>The combined status response, or 401 when the caller is not authenticated.</returns>
    [HttpGet]
    public async Task<IActionResult> Status()
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

        // Manifest revisions for every manifest this user can access, built via the shared helper, plus which of them
        // is their own: the client needs the id to tell its personal vault from the shared ones it syncs alongside.
        var accessScope = await ManifestAccessHelper.ResolveScopeAsync(context, user.Id, user.PersonalGroupId);
        var manifestRevisions = await VaultStatusHelper.GetManifestRevisionsAsync(context, accessScope);
        var personalManifestId = await GroupHelper.GetPersonalManifestIdAsync(context, user.PersonalGroupId);

        // Latest revision of every bucket available to the caller.
        var accessibleManifestIds = manifestRevisions.Select(m => m.ManifestId).ToList();
        var bucketRevisions = await context.VaultDataBuckets
            .Where(x => accessibleManifestIds.Contains(x.ManifestId))
            .Select(x => new BucketRevision { ManifestId = x.ManifestId, Category = x.Category, Revision = x.RevisionNumber })
            .ToListAsync();

        // Current SRP salt: lives on the password VaultManifestAccessKey for v2 migrated users, on the personal manifest for legacy users.
        var encryptionSettings = await AuthHelper.GetUserLatestVaultEncryptionSettingsAsync(context, user);

        // Check client version compatibility if the header is provided.
        var clientSupported = false;
        var clientInfo = ClientHeaderInfo.Parse(ClientHeader);
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
            ManifestRevisions = manifestRevisions,
            PersonalManifestId = personalManifestId,
            BucketRevisions = bucketRevisions,
            Capabilities = await capabilityService.GetCapabilitiesAsync(user.Id, ClientHeader),
            PendingActions = await ClientActionHelper.GetPendingActionsAsync(context, user.Id),
        });
    }
}
