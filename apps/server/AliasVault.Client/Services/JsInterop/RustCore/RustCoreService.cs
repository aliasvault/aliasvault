//-----------------------------------------------------------------------
// <copyright file="RustCoreService.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Services.JsInterop.RustCore;

using System.Text.Json;
using Microsoft.JSInterop;

/// <summary>
/// JavaScript interop wrapper for the Rust WASM core library.
/// Provides vault merge and credential matching functionality via WASM.
/// </summary>
public class RustCoreService : IAsyncDisposable
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        WriteIndented = false,
    };

    private readonly IJSRuntime jsRuntime;
    private bool? isAvailable;

    /// <summary>
    /// Initializes a new instance of the <see cref="RustCoreService"/> class.
    /// </summary>
    /// <param name="jsRuntime">The JS runtime for interop.</param>
    public RustCoreService(IJSRuntime jsRuntime)
    {
        this.jsRuntime = jsRuntime;
    }

    /// <summary>
    /// Check if the Rust WASM module is available.
    /// </summary>
    /// <returns>True if the WASM module is loaded and available.</returns>
    public async Task<bool> IsAvailableAsync()
    {
        // Only return cached result if it's true (successful initialization).
        // If false or null, we should try again since WASM might still be loading.
        if (isAvailable == true)
        {
            return true;
        }

        try
        {
            var result = await jsRuntime.InvokeAsync<bool>("rustCoreIsAvailable");
            if (result)
            {
                isAvailable = true;
            }

            return result;
        }
        catch
        {
            return false;
        }
    }

    /// <summary>
    /// Wait for the Rust WASM module to become available with retries.
    /// Uses exponential backoff for more robust loading in slow environments (e.g., E2E tests, mobile devices).
    /// Default timeout is ~30 seconds to handle slow network conditions.
    /// </summary>
    /// <param name="maxRetries">Maximum number of retry attempts.</param>
    /// <param name="initialDelayMs">Initial delay between retries in milliseconds.</param>
    /// <returns>True if the WASM module became available.</returns>
    public async Task<bool> WaitForAvailabilityAsync(int maxRetries = 30, int initialDelayMs = 100)
    {
        var currentDelay = initialDelayMs;

        for (int i = 0; i < maxRetries; i++)
        {
            if (await IsAvailableAsync())
            {
                return true;
            }

            await Task.Delay(currentDelay);

            // Exponential backoff with cap at 2 seconds
            currentDelay = Math.Min(currentDelay * 2, 2000);
        }

        return false;
    }

    /// <summary>
    /// Merge two vaults using Last-Write-Wins (LWW) strategy.
    /// </summary>
    /// <param name="input">The merge input containing local and server tables.</param>
    /// <returns>The merge output with SQL statements to execute.</returns>
    /// <exception cref="InvalidOperationException">Thrown if merge fails or WASM module is unavailable.</exception>
    public async Task<MergeOutput> MergeVaultsAsync(MergeInput input)
    {
        // Wait for WASM to be available with retries, as it may still be loading.
        if (!await WaitForAvailabilityAsync())
        {
            throw new InvalidOperationException("Rust WASM module is not available.");
        }

        var inputJson = JsonSerializer.Serialize(input, JsonOptions);
        var resultJson = await jsRuntime.InvokeAsync<string>("rustCoreMergeVaults", inputJson);

        if (string.IsNullOrEmpty(resultJson))
        {
            throw new InvalidOperationException("Merge operation returned empty result.");
        }

        var result = JsonSerializer.Deserialize<MergeOutput>(resultJson, JsonOptions);
        if (result == null)
        {
            throw new InvalidOperationException("Failed to deserialize merge result.");
        }

        if (!result.Success && !string.IsNullOrEmpty(result.Error))
        {
            throw new InvalidOperationException($"Merge failed: {result.Error}");
        }

        return result;
    }

    /// <summary>
    /// Get the list of table names that need to be synced.
    /// </summary>
    /// <returns>Array of table names.</returns>
    /// <exception cref="InvalidOperationException">Thrown if WASM module is unavailable.</exception>
    public async Task<string[]> GetSyncableTableNamesAsync()
    {
        // Wait for WASM to be available with retries, as it may still be loading.
        if (!await WaitForAvailabilityAsync())
        {
            throw new InvalidOperationException("Rust WASM module is not available.");
        }

        var result = await jsRuntime.InvokeAsync<string[]>("rustCoreGetSyncableTableNames");
        if (result == null || result.Length == 0)
        {
            throw new InvalidOperationException("Failed to get syncable table names from Rust WASM.");
        }

        return result;
    }

    /// <summary>
    /// Prune expired items from trash.
    /// Items that have been in trash (DeletedAt set) for longer than retentionDays
    /// are permanently deleted (IsDeleted = true).
    /// </summary>
    /// <param name="input">The prune input containing table data and retention period.</param>
    /// <returns>The prune output with SQL statements to execute.</returns>
    /// <exception cref="InvalidOperationException">Thrown if prune fails or WASM module is unavailable.</exception>
    public async Task<PruneOutput> PruneVaultAsync(PruneInput input)
    {
        // Wait for WASM to be available with retries, as it may still be loading.
        if (!await WaitForAvailabilityAsync())
        {
            throw new InvalidOperationException("Rust WASM module is not available.");
        }

        var inputJson = JsonSerializer.Serialize(input, JsonOptions);
        var resultJson = await jsRuntime.InvokeAsync<string>("rustCorePruneVault", inputJson);

        if (string.IsNullOrEmpty(resultJson))
        {
            throw new InvalidOperationException("Prune operation returned empty result.");
        }

        var result = JsonSerializer.Deserialize<PruneOutput>(resultJson, JsonOptions);
        if (result == null)
        {
            throw new InvalidOperationException("Failed to deserialize prune result.");
        }

        if (!result.Success && !string.IsNullOrEmpty(result.Error))
        {
            throw new InvalidOperationException($"Prune failed: {result.Error}");
        }

        return result;
    }

    /// <summary>
    /// Extract domain from URL.
    /// </summary>
    /// <param name="url">The URL to extract domain from.</param>
    /// <returns>The extracted domain.</returns>
    public async Task<string> ExtractDomainAsync(string url)
    {
        if (!await IsAvailableAsync())
        {
            return string.Empty;
        }

        try
        {
            return await jsRuntime.InvokeAsync<string>("rustCoreExtractDomain", url);
        }
        catch
        {
            return string.Empty;
        }
    }

    /// <summary>
    /// Extract root domain from a domain string.
    /// </summary>
    /// <param name="domain">The domain to extract root from.</param>
    /// <returns>The root domain.</returns>
    public async Task<string> ExtractRootDomainAsync(string domain)
    {
        if (!await IsAvailableAsync())
        {
            return string.Empty;
        }

        try
        {
            return await jsRuntime.InvokeAsync<string>("rustCoreExtractRootDomain", domain);
        }
        catch
        {
            return string.Empty;
        }
    }

    /// <inheritdoc/>
    public ValueTask DisposeAsync()
    {
        return ValueTask.CompletedTask;
    }
}
