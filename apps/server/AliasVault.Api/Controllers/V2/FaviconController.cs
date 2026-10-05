//-----------------------------------------------------------------------
// <copyright file="FaviconController.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Controllers.V2;

using AliasServerDb;
using AliasVault.Api.Controllers.Abstracts;
using AliasVault.Api.Helpers;
using AliasVault.Api.Services;
using AliasVault.Shared.Models.Enums;
using AliasVault.Shared.Models.WebApi.V2.Favicon;
using Asp.Versioning;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;

/// <summary>
/// Controller for retrieving favicons from external websites.
/// </summary>
/// <param name="userManager">UserManager instance.</param>
/// <param name="rateLimitService">In-memory per-user favicon extraction rate limiter.</param>
/// <param name="logger">Logger instance.</param>
[ApiVersion("2")]
public class FaviconController(
    UserManager<AliasVaultUser> userManager,
    FaviconRateLimitService rateLimitService,
    ILogger<FaviconController> logger) : AuthenticatedRequestController(userManager)
{
    /// <summary>
    /// Maximum number of URLs accepted in a single batch request.
    /// </summary>
    public const int MaxBatchSize = 10;

    /// <summary>
    /// Extracts the favicon from a single URL.
    /// </summary>
    /// <param name="url">URL to extract the favicon from.</param>
    /// <returns>Favicon image bytes, or null if extraction failed.</returns>
    [HttpGet("Extract")]
    public async Task<IActionResult> Extract(string url)
    {
        var user = await GetCurrentUserAsync();
        if (user == null)
        {
            return ApiError.Result(ApiErrorCode.NOT_AUTHENTICATED, 401);
        }

        if (!rateLimitService.TryConsume(user.Id, 1))
        {
            return ApiError.Result(ApiErrorCode.RATE_LIMIT_EXCEEDED, 429);
        }

        try
        {
            var image = await FaviconExtractor.FaviconExtractor.GetFaviconAsync(url);
            return Ok(new FaviconExtractModel { Image = image });
        }
        catch (Exception ex)
        {
            logger.LogInformation(ex, "Failed to extract favicon from {Url}", AnonymizeUrl(url));
        }

        return Ok(new FaviconExtractModel { Image = null });
    }

    /// <summary>
    /// Extracts favicons for multiple URLs in parallel server-side. Cuts down on round trips when
    /// the client needs to fetch many favicons (initial vault import, bulk re-download from the
    /// storage insights page).
    /// </summary>
    /// <param name="request">The batch request payload.</param>
    /// <returns>A list of favicon results, one per requested URL, in the same order.</returns>
    [HttpPost("ExtractBatch")]
    public async Task<IActionResult> ExtractBatch([FromBody] FaviconExtractBatchRequest request)
    {
        var user = await GetCurrentUserAsync();
        if (user == null)
        {
            return ApiError.Result(ApiErrorCode.NOT_AUTHENTICATED, 401);
        }

        if (request.Urls.Count == 0)
        {
            return Ok(new FaviconExtractBatchResponse());
        }

        if (request.Urls.Count > MaxBatchSize)
        {
            return ApiError.Result(ApiErrorCode.INVALID_REQUEST, 400);
        }

        if (!rateLimitService.TryConsume(user.Id, request.Urls.Count))
        {
            return ApiError.Result(ApiErrorCode.RATE_LIMIT_EXCEEDED, 429);
        }

        var images = await FaviconExtractor.FaviconExtractor.GetFaviconsAsync(request.Urls);

        var response = new FaviconExtractBatchResponse
        {
            Results = new List<FaviconExtractBatchResult>(request.Urls.Count),
        };

        for (int i = 0; i < request.Urls.Count; i++)
        {
            response.Results.Add(new FaviconExtractBatchResult
            {
                Url = request.Urls[i],
                Image = images[i],
            });
        }

        return Ok(response);
    }

    /// <summary>
    /// Anonymizes a URL by replacing letters with 'x'. Lets us log host structure without
    /// recording the actual domain a user was browsing.
    /// </summary>
    private static string AnonymizeUrl(string url)
    {
        return new string(url.Select(c => char.IsLetter(c) ? 'x' : c).ToArray());
    }
}
