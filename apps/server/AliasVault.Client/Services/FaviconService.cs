//-----------------------------------------------------------------------
// <copyright file="FaviconService.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Services;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Threading;
using System.Threading.Tasks;
using AliasVault.Shared.Models.WebApi.V1.Favicon;

/// <summary>
/// Wraps calls to the server-side favicon API. Centralizes the single-URL and batched
/// extraction paths so item add/edit, vault import, and bulk re-download all share one
/// implementation (and one place to evolve, e.g. when adjusting batch size).
/// </summary>
public sealed class FaviconService(HttpClient httpClient)
{
    /// <summary>
    /// Number of URLs sent per batch request. Mirrors <c>FaviconController.MaxBatchSize</c> on the server.
    /// </summary>
    public const int BatchSize = 10;

    /// <summary>
    /// Outcome of a bulk extraction.
    /// </summary>
    public enum BulkExtractStatus
    {
        /// <summary>All requested URLs were processed.</summary>
        Completed,

        /// <summary>The user cancelled the operation before all URLs were processed.</summary>
        Cancelled,

        /// <summary>Server returned 429 — the per-user 24h rate limit was hit. Partial results are returned.</summary>
        RateLimited,
    }

    /// <summary>
    /// Normalizes a URL to a lowercase host without leading "www.". Returns false for URLs that
    /// can't be parsed; callers should skip those rather than fall back to a different key.
    /// </summary>
    /// <param name="url">The URL to normalize.</param>
    /// <param name="domain">The normalized domain.</param>
    /// <returns>True if the URL was parseable.</returns>
    public static bool TryNormalizeDomain(string url, out string domain)
    {
        domain = string.Empty;
        if (string.IsNullOrWhiteSpace(url))
        {
            return false;
        }

        try
        {
            var host = new Uri(url).Host.ToLowerInvariant();
            if (host.StartsWith("www.", StringComparison.Ordinal))
            {
                host = host[4..];
            }

            if (string.IsNullOrEmpty(host))
            {
                return false;
            }

            domain = host;
            return true;
        }
        catch
        {
            return false;
        }
    }

    /// <summary>
    /// Extracts the favicon for a single URL.
    /// </summary>
    /// <param name="url">The URL to fetch the favicon for.</param>
    /// <returns>Favicon bytes, or null if extraction failed or the rate limit was hit.</returns>
    public async Task<byte[]?> ExtractAsync(string url)
    {
        try
        {
            var apiReturn = await httpClient.GetFromJsonAsync<FaviconExtractModel>(
                $"v1/Favicon/Extract?url={Uri.EscapeDataString(url)}");
            return apiReturn?.Image;
        }
        catch
        {
            return null;
        }
    }

    /// <summary>
    /// Extracts favicons for many URLs in batches, deduplicating by normalized domain so the
    /// same domain is only fetched once even if many items reference it.
    /// </summary>
    /// <param name="urls">URLs to extract favicons for. Duplicates by domain are collapsed.</param>
    /// <param name="progress">
    /// Optional progress callback. Receives the number of unique domains processed so far
    /// (regardless of fetch success). The total reported is the count of unique domains, not
    /// the count of input URLs.
    /// </param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The favicon dictionary plus the operation status.</returns>
    public async Task<BulkExtractResult> ExtractBulkAsync(IEnumerable<string> urls, IProgress<int>? progress = null, CancellationToken cancellationToken = default)
    {
        var favicons = new Dictionary<string, byte[]>();

        // Deduplicate by domain up front so a 5000-item vault that all uses 200 unique domains
        // makes 200 fetches, not 5000.
        var domainToUrl = new Dictionary<string, string>();
        foreach (var url in urls)
        {
            if (string.IsNullOrWhiteSpace(url))
            {
                continue;
            }

            if (TryNormalizeDomain(url, out var domain) && !domainToUrl.ContainsKey(domain))
            {
                domainToUrl[domain] = url;
            }
        }

        if (domainToUrl.Count == 0)
        {
            return new BulkExtractResult(favicons, BulkExtractStatus.Completed);
        }

        var entries = domainToUrl.ToList();
        int processed = 0;

        for (int i = 0; i < entries.Count; i += BatchSize)
        {
            if (cancellationToken.IsCancellationRequested)
            {
                return new BulkExtractResult(favicons, BulkExtractStatus.Cancelled);
            }

            var chunk = entries.Skip(i).Take(BatchSize).ToList();
            var request = new FaviconExtractBatchRequest
            {
                Urls = chunk.Select(e => e.Value).ToList(),
            };

            HttpResponseMessage response;
            try
            {
                response = await httpClient.PostAsJsonAsync("v1/Favicon/ExtractBatch", request, cancellationToken);
            }
            catch
            {
                // Network or other transport error — treat the whole chunk as failed but keep going.
                processed += chunk.Count;
                progress?.Report(processed);
                continue;
            }

            if (response.StatusCode == HttpStatusCode.TooManyRequests)
            {
                return new BulkExtractResult(favicons, BulkExtractStatus.RateLimited);
            }

            if (!response.IsSuccessStatusCode)
            {
                processed += chunk.Count;
                progress?.Report(processed);
                continue;
            }

            FaviconExtractBatchResponse? body;
            try
            {
                body = await response.Content.ReadFromJsonAsync<FaviconExtractBatchResponse>(cancellationToken: cancellationToken);
            }
            catch
            {
                processed += chunk.Count;
                progress?.Report(processed);
                continue;
            }

            if (body?.Results != null)
            {
                // Match results back to the domains we asked for. Server echoes the URL, but matching
                // by index is robust against any normalization differences.
                for (int j = 0; j < body.Results.Count && j < chunk.Count; j++)
                {
                    var image = body.Results[j].Image;
                    if (image != null)
                    {
                        favicons[chunk[j].Key] = image;
                    }
                }
            }

            processed += chunk.Count;
            progress?.Report(processed);
        }

        return new BulkExtractResult(favicons, BulkExtractStatus.Completed);
    }

    /// <summary>
    /// Result of a bulk extraction call. Favicons are keyed by normalized domain so callers
    /// can reuse a single fetched favicon across all items that share that domain.
    /// </summary>
    /// <param name="Favicons">Dictionary of normalized domain to favicon bytes.</param>
    /// <param name="Status">Outcome of the operation.</param>
    public record BulkExtractResult(Dictionary<string, byte[]> Favicons, BulkExtractStatus Status);
}
