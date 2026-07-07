//-----------------------------------------------------------------------
// <copyright file="RootController.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Controllers;

using AliasServerDb;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

/// <summary>
/// Root controller that contains health check endpoints.
/// </summary>
[ApiController]
[Route("/")]
public class RootController(IAliasServerDbContextFactory dbContextFactory) : ControllerBase
{
    /// <summary>
    /// Root endpoint that returns a 200 OK if the database connection is successful
    /// and the DB migrations are up-to-date.
    /// </summary>
    /// <returns>Http 200 if database connection is successful.</returns>
    [HttpGet]
    [HttpHead]
    [ProducesResponseType<int>(StatusCodes.Status200OK)]
    [ProducesResponseType<int>(StatusCodes.Status500InternalServerError)]
    public async Task<IActionResult> Get()
    {
        try
        {
            await using var context = await dbContextFactory.CreateDbContextAsync();

            // Verify we can actually reach the database.
            if (!await context.Database.CanConnectAsync())
            {
                return StatusCode(500, "ERROR: Database unreachable");
            }

            // Check if the database schema exists.
            IEnumerable<string> appliedMigrations;
            try
            {
                appliedMigrations = await context.Database.GetAppliedMigrationsAsync();
            }
            catch
            {
                return StatusCode(500, "ERROR: Database schema not initialized");
            }

            // Check if the database schema is up-to-date.
            var allMigrations = context.Database.GetMigrations();
            if (allMigrations.Except(appliedMigrations).Any())
            {
                return StatusCode(500, "ERROR: Database schema outdated (pending migrations)");
            }

            // Database is reachable and up-to-date.
            return Ok("OK");
        }
        catch (Exception ex) when (ex is TimeoutException or OperationCanceledException)
        {
            return StatusCode(500, "ERROR: Database timeout");
        }
        catch
        {
            return StatusCode(500, "ERROR: Database error");
        }
    }
}
