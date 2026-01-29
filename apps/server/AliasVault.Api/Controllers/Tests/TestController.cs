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

namespace AliasVault.Api.Controllers.Tests;

using AliasServerDb;
using AliasVault.Api.Controllers.Abstracts;
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
[ApiVersion("1")]
public class TestController(
    UserManager<AliasVaultUser> userManager,
    IWebHostEnvironment environment,
    IAliasServerDbContextFactory dbContextFactory) : AuthenticatedRequestController(userManager)
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

        // Get the newest revisions to delete
        var revisionsToDelete = await context.Vaults
            .Where(v => v.UserId == user.Id)
            .OrderByDescending(v => v.RevisionNumber)
            .Take(count)
            .ToListAsync();

        if (revisionsToDelete.Count == 0)
        {
            return Ok(new { deleted = 0, message = "No revisions found to delete" });
        }

        // Delete the revisions
        context.Vaults.RemoveRange(revisionsToDelete);
        var deletedCount = await context.SaveChangesAsync();

        return Ok(new
        {
            deleted = revisionsToDelete.Count,
            deletedRevisions = revisionsToDelete.Select(r => r.RevisionNumber).ToList(),
            message = $"Deleted {revisionsToDelete.Count} vault revision(s)",
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

        var revisions = await context.Vaults
            .Where(v => v.UserId == user.Id)
            .OrderByDescending(v => v.RevisionNumber)
            .Select(v => new
            {
                v.RevisionNumber,
                v.CreatedAt,
                v.UpdatedAt,
            })
            .ToListAsync();

        return Ok(new
        {
            count = revisions.Count,
            currentRevision = revisions.FirstOrDefault()?.RevisionNumber ?? 0,
            revisions,
        });
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

        var revisions = await context.Vaults
            .Where(v => v.UserId == user.Id)
            .OrderByDescending(v => v.RevisionNumber)
            .Select(v => new
            {
                v.RevisionNumber,
                v.CreatedAt,
                v.UpdatedAt,
            })
            .ToListAsync();

        return Ok(new
        {
            count = revisions.Count,
            currentRevision = revisions.FirstOrDefault()?.RevisionNumber ?? 0,
            revisions,
        });
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

        // Get the newest revisions to delete
        var revisionsToDelete = await context.Vaults
            .Where(v => v.UserId == user.Id)
            .OrderByDescending(v => v.RevisionNumber)
            .Take(count)
            .ToListAsync();

        if (revisionsToDelete.Count == 0)
        {
            return Ok(new { deleted = 0, message = "No revisions found to delete" });
        }

        // Delete the revisions
        context.Vaults.RemoveRange(revisionsToDelete);
        await context.SaveChangesAsync();

        return Ok(new
        {
            deleted = revisionsToDelete.Count,
            deletedRevisions = revisionsToDelete.Select(r => r.RevisionNumber).ToList(),
            message = $"Deleted {revisionsToDelete.Count} vault revision(s)",
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
}
#endif
