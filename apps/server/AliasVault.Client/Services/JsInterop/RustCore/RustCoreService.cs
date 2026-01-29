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

    /// <summary>
    /// Generate a random salt for SRP registration.
    /// </summary>
    /// <returns>64-character uppercase hex string (32 bytes).</returns>
    /// <exception cref="InvalidOperationException">Thrown if WASM module is unavailable.</exception>
    public async Task<string> SrpGenerateSaltAsync()
    {
        if (!await WaitForAvailabilityAsync())
        {
            throw new InvalidOperationException("Rust WASM module is not available.");
        }

        return await jsRuntime.InvokeAsync<string>("rustCoreSrpGenerateSalt");
    }

    /// <summary>
    /// Derive a private key from salt, identity, and password hash.
    /// </summary>
    /// <param name="salt">The salt (hex string).</param>
    /// <param name="identity">The SRP identity (username or GUID), will be lowercased.</param>
    /// <param name="passwordHash">The password hash (hex string).</param>
    /// <returns>64-character uppercase hex string (32 bytes).</returns>
    /// <exception cref="InvalidOperationException">Thrown if WASM module is unavailable.</exception>
    public async Task<string> SrpDerivePrivateKeyAsync(string salt, string identity, string passwordHash)
    {
        if (!await WaitForAvailabilityAsync())
        {
            throw new InvalidOperationException("Rust WASM module is not available.");
        }

        // Make sure the identity is lowercase as the SRP protocol is case sensitive.
        identity = identity.ToLowerInvariant();

        return await jsRuntime.InvokeAsync<string>("rustCoreSrpDerivePrivateKey", salt, identity, passwordHash);
    }

    /// <summary>
    /// Derive a verifier from a private key.
    /// </summary>
    /// <param name="privateKey">The private key (hex string).</param>
    /// <returns>512-character uppercase hex string (256 bytes).</returns>
    /// <exception cref="InvalidOperationException">Thrown if WASM module is unavailable.</exception>
    public async Task<string> SrpDeriveVerifierAsync(string privateKey)
    {
        if (!await WaitForAvailabilityAsync())
        {
            throw new InvalidOperationException("Rust WASM module is not available.");
        }

        return await jsRuntime.InvokeAsync<string>("rustCoreSrpDeriveVerifier", privateKey);
    }

    /// <summary>
    /// Generate client ephemeral keypair.
    /// </summary>
    /// <returns>Ephemeral object with Public and Secret hex strings.</returns>
    /// <exception cref="InvalidOperationException">Thrown if WASM module is unavailable.</exception>
    public async Task<SrpEphemeral> SrpGenerateEphemeralAsync()
    {
        if (!await WaitForAvailabilityAsync())
        {
            throw new InvalidOperationException("Rust WASM module is not available.");
        }

        return await jsRuntime.InvokeAsync<SrpEphemeral>("rustCoreSrpGenerateEphemeral");
    }

    /// <summary>
    /// Derive client session from ephemeral values.
    /// </summary>
    /// <param name="clientSecret">Client ephemeral secret (hex string).</param>
    /// <param name="serverPublic">Server ephemeral public (hex string).</param>
    /// <param name="salt">The salt (hex string).</param>
    /// <param name="identity">The SRP identity, will be lowercased.</param>
    /// <param name="privateKey">The private key (hex string).</param>
    /// <returns>Session object with Key and Proof hex strings.</returns>
    /// <exception cref="InvalidOperationException">Thrown if WASM module is unavailable.</exception>
    public async Task<SrpSession> SrpDeriveSessionAsync(string clientSecret, string serverPublic, string salt, string identity, string privateKey)
    {
        if (!await WaitForAvailabilityAsync())
        {
            throw new InvalidOperationException("Rust WASM module is not available.");
        }

        // Make sure the identity is lowercase as the SRP protocol is case sensitive.
        identity = identity.ToLowerInvariant();

        return await jsRuntime.InvokeAsync<SrpSession>("rustCoreSrpDeriveSession", clientSecret, serverPublic, salt, identity, privateKey);
    }

    /// <summary>
    /// Derive session client-side (convenience method with reordered parameters).
    /// </summary>
    /// <param name="privateKey">The private key.</param>
    /// <param name="clientSecretEphemeral">Client ephemeral secret.</param>
    /// <param name="serverEphemeralPublic">Server public ephemeral.</param>
    /// <param name="salt">Salt.</param>
    /// <param name="identity">Identity.</param>
    /// <returns>SrpSession.</returns>
    public async Task<SrpSession> SrpDeriveSessionClientAsync(string privateKey, string clientSecretEphemeral, string serverEphemeralPublic, string salt, string identity)
    {
        return await SrpDeriveSessionAsync(clientSecretEphemeral, serverEphemeralPublic, salt, identity, privateKey);
    }

    /// <summary>
    /// Verify the server's session proof (M2) on the client side.
    /// </summary>
    /// <param name="clientPublic">Client public ephemeral (A).</param>
    /// <param name="clientSession">Client session containing proof (M1) and key (K).</param>
    /// <param name="serverProof">Server proof (M2) to verify.</param>
    /// <returns>A task representing the asynchronous operation.</returns>
    /// <exception cref="InvalidOperationException">Thrown if WASM module is unavailable.</exception>
    /// <exception cref="System.Security.SecurityException">Thrown if verification fails.</exception>
    public async Task SrpVerifySessionAsync(string clientPublic, SrpSession clientSession, string serverProof)
    {
        if (!await WaitForAvailabilityAsync())
        {
            throw new InvalidOperationException("Rust WASM module is not available.");
        }

        var result = await jsRuntime.InvokeAsync<bool>("rustCoreSrpVerifySession", clientPublic, clientSession.Proof, clientSession.Key, serverProof);

        if (!result)
        {
            throw new System.Security.SecurityException("Server session proof verification failed.");
        }
    }

    /// <inheritdoc/>
    public ValueTask DisposeAsync()
    {
        return ValueTask.CompletedTask;
    }

    /// <summary>
    /// Wait for the Rust WASM module to become available with retries.
    /// Uses exponential backoff for more robust loading in slow environments (e.g., E2E tests, mobile devices).
    /// Default timeout is ~30 seconds to handle slow network conditions.
    /// </summary>
    /// <param name="maxRetries">Maximum number of retry attempts.</param>
    /// <param name="initialDelayMs">Initial delay between retries in milliseconds.</param>
    /// <returns>True if the WASM module became available.</returns>
    private async Task<bool> WaitForAvailabilityAsync(int maxRetries = 30, int initialDelayMs = 100)
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
}
