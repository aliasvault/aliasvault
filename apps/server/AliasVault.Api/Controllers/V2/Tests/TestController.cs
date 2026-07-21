//-----------------------------------------------------------------------
// <copyright file="TestController.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

/*
 * Note: this file is used for E2E testing purposes only. It contains test endpoints that are used by
 * E2E tests (browser extension Playwright tests, mobile app UI tests) to manipulate server state.
 *
 * These endpoints are only available in DEBUG builds.
 */

namespace AliasVault.Api.Controllers.V2.Tests;

using AliasServerDb;
using AliasVault.Api.Controllers.Abstracts;
using AliasVault.Api.Controllers.Tests;
using AliasVault.Shared.Server.Services;
using Asp.Versioning;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

#if DEBUG

/// <summary>
/// Test controller that contains test endpoints for E2E testing purposes.
/// All endpoints are hidden from Swagger and only work in Development environment.
/// </summary>
/// <param name="userManager">UserManager instance.</param>
/// <param name="environment">IWebHostEnvironment instance.</param>
/// <param name="dbContextFactory">DbContext factory instance.</param>
/// <param name="serverSettingsService">ServerSettingsService instance.</param>
[ApiVersion("2")]
public class TestController(
    UserManager<AliasVaultUser> userManager,
    IWebHostEnvironment environment,
    IAliasServerDbContextFactory dbContextFactory,
    ServerSettingsService serverSettingsService) : AuthenticatedRequestController(userManager)
{
    /// <summary>
    /// Authenticated test request. Used to verify authentication is working.
    /// </summary>
    /// <returns>Static OK.</returns>
    [HttpGet("")]
    public IActionResult TestCall()
    {
        if (!environment.IsDevelopment())
        {
            return NotFound();
        }

        return Ok();
    }

    /// <summary>
    /// Test request that throws an exception. Used for testing error handling.
    /// </summary>
    /// <returns>Never returns - always throws.</returns>
    [AllowAnonymous]
    [HttpGet("Error")]
    public IActionResult TestCallError()
    {
        if (!environment.IsDevelopment())
        {
            return NotFound();
        }

        // Throw an exception here to test error handling.
        throw new ArgumentException("Test error");
    }

    /// <summary>
    /// Delete the newest vault revisions for the current user.
    /// Used for testing RPO (Recovery Point Objective) recovery scenarios.
    /// </summary>
    /// <param name="count">Number of newest revisions to delete.</param>
    /// <returns>OK with the number of deleted revisions, or NotFound in production.</returns>
    [HttpDelete("vault-revisions/{count:int}")]
    public async Task<IActionResult> DeleteVaultRevisions(int count)
    {
        if (!environment.IsDevelopment())
        {
            return NotFound();
        }

        if (count <= 0)
        {
            return BadRequest("Count must be greater than 0");
        }

        var user = await GetCurrentUserAsync();
        if (user == null)
        {
            return Unauthorized();
        }

        await using var context = await dbContextFactory.CreateDbContextAsync();

        var deletedRevisions = await PopNewestRevisionsAsync(context, user.Id, count);
        if (deletedRevisions.Count == 0)
        {
            return Ok(new { deleted = 0, message = "No revisions found to delete" });
        }

        return Ok(new
        {
            deleted = deletedRevisions.Count,
            deletedRevisions,
            message = $"Deleted {deletedRevisions.Count} vault revision(s)",
        });
    }

    /// <summary>
    /// Get vault revision information for the current user.
    /// Used for E2E tests to verify vault state.
    /// </summary>
    /// <returns>Vault revision information.</returns>
    [HttpGet("vault-revisions")]
    public async Task<IActionResult> GetVaultRevisions()
    {
        if (!environment.IsDevelopment())
        {
            return NotFound();
        }

        var user = await GetCurrentUserAsync();
        if (user == null)
        {
            return Unauthorized();
        }

        await using var context = await dbContextFactory.CreateDbContextAsync();

        return Ok(await BuildRevisionInfoAsync(context, user.Id));
    }

    /// <summary>
    /// Block the current user's account.
    /// Used for testing forced logout scenarios.
    /// After calling this, any subsequent API calls to /status will return 401.
    /// </summary>
    /// <returns>OK with the blocked status.</returns>
    [HttpPost("block-user")]
    public async Task<IActionResult> BlockUser()
    {
        if (!environment.IsDevelopment())
        {
            return NotFound();
        }

        var user = await GetCurrentUserAsync();
        if (user == null)
        {
            return Unauthorized();
        }

        await using var context = await dbContextFactory.CreateDbContextAsync();

        // Find the user in the new context and block them
        var dbUser = await context.AliasVaultUsers.FindAsync(user.Id);
        if (dbUser == null)
        {
            return NotFound("User not found");
        }

        dbUser.Blocked = true;
        await context.SaveChangesAsync();

        return Ok(new
        {
            blocked = true,
            message = $"User {user.UserName} has been blocked",
        });
    }

    /// <summary>
    /// Unblock the current user's account.
    /// Used for testing - allows re-enabling the account after forced logout test.
    /// Note: This uses the JWT token which is still valid even for blocked users,
    /// so the user can unblock themselves for testing purposes.
    /// </summary>
    /// <returns>OK with the blocked status.</returns>
    [HttpPost("unblock-user")]
    public async Task<IActionResult> UnblockUser()
    {
        if (!environment.IsDevelopment())
        {
            return NotFound();
        }

        var user = await GetCurrentUserAsync();
        if (user == null)
        {
            return Unauthorized();
        }

        await using var context = await dbContextFactory.CreateDbContextAsync();

        // Find the user in the new context and unblock them
        var dbUser = await context.AliasVaultUsers.FindAsync(user.Id);
        if (dbUser == null)
        {
            return NotFound("User not found");
        }

        dbUser.Blocked = false;
        await context.SaveChangesAsync();

        return Ok(new
        {
            blocked = false,
            message = $"User {user.UserName} has been unblocked",
        });
    }

    /// <summary>
    /// Get vault revision information for a user by username.
    /// Anonymous endpoint for E2E tests that cannot access auth tokens.
    /// Only available in DEBUG builds.
    /// </summary>
    /// <param name="username">The username to look up.</param>
    /// <returns>Vault revision information.</returns>
    [AllowAnonymous]
    [HttpGet("vault-revisions/by-username/{username}")]
    public async Task<IActionResult> GetVaultRevisionsByUsername(string username)
    {
        if (!environment.IsDevelopment())
        {
            return NotFound();
        }

        await using var context = await dbContextFactory.CreateDbContextAsync();

        var user = await context.AliasVaultUsers
            .FirstOrDefaultAsync(u => u.NormalizedUserName == username.ToUpperInvariant());

        if (user == null)
        {
            return NotFound($"User '{username}' not found");
        }

        return Ok(await BuildRevisionInfoAsync(context, user.Id));
    }

    /// <summary>
    /// Delete the newest vault revisions for a user by username.
    /// Anonymous endpoint for E2E tests that cannot access auth tokens.
    /// Only available in DEBUG builds.
    /// </summary>
    /// <param name="username">The username to look up.</param>
    /// <param name="count">Number of newest revisions to delete.</param>
    /// <returns>OK with the number of deleted revisions.</returns>
    [AllowAnonymous]
    [HttpDelete("vault-revisions/by-username/{username}/{count:int}")]
    public async Task<IActionResult> DeleteVaultRevisionsByUsername(string username, int count)
    {
        if (!environment.IsDevelopment())
        {
            return NotFound();
        }

        if (count <= 0)
        {
            return BadRequest("Count must be greater than 0");
        }

        await using var context = await dbContextFactory.CreateDbContextAsync();

        var user = await context.AliasVaultUsers
            .FirstOrDefaultAsync(u => u.NormalizedUserName == username.ToUpperInvariant());

        if (user == null)
        {
            return NotFound($"User '{username}' not found");
        }

        var deletedRevisions = await PopNewestRevisionsAsync(context, user.Id, count);
        if (deletedRevisions.Count == 0)
        {
            return Ok(new { deleted = 0, message = "No revisions found to delete" });
        }

        return Ok(new
        {
            deleted = deletedRevisions.Count,
            deletedRevisions,
            message = $"Deleted {deletedRevisions.Count} vault revision(s)",
        });
    }

    /// <summary>
    /// Block a user's account by username.
    /// Anonymous endpoint for E2E tests that cannot access auth tokens.
    /// Only available in DEBUG builds.
    /// </summary>
    /// <param name="username">The username to block.</param>
    /// <returns>OK with the blocked status.</returns>
    [AllowAnonymous]
    [HttpPost("block-user/by-username/{username}")]
    public async Task<IActionResult> BlockUserByUsername(string username)
    {
        if (!environment.IsDevelopment())
        {
            return NotFound();
        }

        await using var context = await dbContextFactory.CreateDbContextAsync();

        var user = await context.AliasVaultUsers
            .FirstOrDefaultAsync(u => u.NormalizedUserName == username.ToUpperInvariant());

        if (user == null)
        {
            return NotFound($"User '{username}' not found");
        }

        user.Blocked = true;
        await context.SaveChangesAsync();

        return Ok(new
        {
            blocked = true,
            message = $"User {user.UserName} has been blocked",
        });
    }

    /// <summary>
    /// Unblock a user's account by username.
    /// Anonymous endpoint for E2E tests that cannot access auth tokens.
    /// Only available in DEBUG builds.
    /// </summary>
    /// <param name="username">The username to unblock.</param>
    /// <returns>OK with the blocked status.</returns>
    [AllowAnonymous]
    [HttpPost("unblock-user/by-username/{username}")]
    public async Task<IActionResult> UnblockUserByUsername(string username)
    {
        if (!environment.IsDevelopment())
        {
            return NotFound();
        }

        await using var context = await dbContextFactory.CreateDbContextAsync();

        var user = await context.AliasVaultUsers
            .FirstOrDefaultAsync(u => u.NormalizedUserName == username.ToUpperInvariant());

        if (user == null)
        {
            return NotFound($"User '{username}' not found");
        }

        user.Blocked = false;
        await context.SaveChangesAsync();

        return Ok(new
        {
            blocked = false,
            message = $"User {user.UserName} has been unblocked",
        });
    }

    /// <summary>
    /// Set a server setting by key/value. Used by E2E tests to tune runtime limits
    /// (e.g. disabling the per-IP registration rate limit by setting it to 0).
    /// Anonymous endpoint for E2E tests that cannot access auth tokens.
    /// Only available in DEBUG builds.
    /// </summary>
    /// <param name="request">The setting to update.</param>
    /// <returns>OK with the updated key and value.</returns>
    [AllowAnonymous]
    [HttpPost("server-settings")]
    public async Task<IActionResult> SetServerSetting([FromBody] SetServerSettingRequest request)
    {
        if (!environment.IsDevelopment())
        {
            return NotFound();
        }

        if (string.IsNullOrWhiteSpace(request.Key))
        {
            return BadRequest("Key is required");
        }

        await serverSettingsService.SetSettingAsync(request.Key, request.Value);

        return Ok(new
        {
            key = request.Key,
            value = request.Value,
        });
    }

    /// <summary>
    /// Get a server setting by key.
    /// Anonymous endpoint for E2E tests that cannot access auth tokens.
    /// Only available in DEBUG builds.
    /// </summary>
    /// <param name="key">The setting key to read.</param>
    /// <returns>OK with the current key and value (value may be null if unset).</returns>
    [AllowAnonymous]
    [HttpGet("server-settings/{key}")]
    public async Task<IActionResult> GetServerSetting(string key)
    {
        if (!environment.IsDevelopment())
        {
            return NotFound();
        }

        var value = await serverSettingsService.GetSettingAsync(key);

        return Ok(new
        {
            key,
            value,
        });
    }

    /// <summary>
    /// Builds the revision info payload for a user: the current revision of the root manifest plus all history
    /// revisions, newest first.
    /// </summary>
    private static async Task<object> BuildRevisionInfoAsync(AliasServerDbContext context, string userId)
    {
        var current = await context.VaultManifests
            .Where(v => v.OwnerUserId == userId && v.IsRoot)
            .Select(v => new { v.RevisionNumber, v.CreatedAt, v.UpdatedAt })
            .FirstOrDefaultAsync();

        var history = await context.VaultManifestsHistory
            .Where(v => v.OwnerUserId == userId)
            .OrderByDescending(v => v.RevisionNumber)
            .Select(v => new { v.RevisionNumber, v.CreatedAt, v.UpdatedAt })
            .ToListAsync();

        var revisions = history.ToList();
        if (current != null)
        {
            revisions.Insert(0, current);
        }

        revisions = revisions.OrderByDescending(v => v.RevisionNumber).ToList();

        return new
        {
            count = revisions.Count,
            currentRevision = current?.RevisionNumber ?? 0,
            revisions,
        };
    }

    /// <summary>
    /// Deletes the newest <paramref name="count"/> revisions of the user's root manifest by rolling the current row
    /// back to the newest history revision each time (the inverse of the archive-then-update upload flow). When no
    /// history remains, the manifest row itself is deleted. Returns the revision numbers that were discarded.
    /// </summary>
    private static async Task<List<long>> PopNewestRevisionsAsync(AliasServerDbContext context, string userId, int count)
    {
        var deletedRevisions = new List<long>();
        var current = await context.VaultManifests.FirstOrDefaultAsync(v => v.OwnerUserId == userId && v.IsRoot);

        for (var i = 0; i < count && current != null; i++)
        {
            deletedRevisions.Add(current.RevisionNumber);

            // Drop the blob references of the revision being discarded.
            await context.VaultBlobReferences.Where(r => r.ManifestId == current.ManifestId && r.RevisionNumber == current.RevisionNumber).ExecuteDeleteAsync();

            var newestHistory = await context.VaultManifestsHistory
                .Where(h => h.ManifestId == current.ManifestId)
                .OrderByDescending(h => h.RevisionNumber)
                .FirstOrDefaultAsync();

            if (newestHistory == null)
            {
                context.VaultManifests.Remove(current);
                current = null;
            }
            else
            {
                current.CopyPayloadFrom(newestHistory);
                context.VaultManifestsHistory.Remove(newestHistory);
            }

            await context.SaveChangesAsync();
        }

        return deletedRevisions;
    }
}
#endif
