//-----------------------------------------------------------------------
// <copyright file="MobileLoginUtility.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Auth.Services;

using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using AliasVault.Client.Auth.Models;
using AliasVault.Client.Services.JsInterop;
using AliasVault.Client.Utilities;
using AliasVault.Shared.Models.WebApi.Auth;
using Microsoft.Extensions.Logging;

/// <summary>
/// Utility class for logging in with mobile app functionality.
/// </summary>
public sealed class MobileLoginUtility : IDisposable
{
    private readonly HttpClient _httpClient;
    private readonly JsInteropService _jsInteropService;
    private readonly ILogger<MobileLoginUtility> _logger;

    private Timer? _pollingTimer;
    private string? _requestId;
    private string? _privateKey;
    private string? _publicKeyHash;
    private CancellationTokenSource? _cancellationTokenSource;

    /// <summary>
    /// Initializes a new instance of the <see cref="MobileLoginUtility"/> class.
    /// </summary>
    /// <param name="httpClient">The HTTP client.</param>
    /// <param name="jsInteropService">The JS interop service.</param>
    /// <param name="logger">The logger.</param>
    public MobileLoginUtility(HttpClient httpClient, JsInteropService jsInteropService, ILogger<MobileLoginUtility> logger)
    {
        _httpClient = httpClient;
        _jsInteropService = jsInteropService;
        _logger = logger;
    }

    /// <summary>
    /// Initiates a mobile login request and returns the request ID and public key hash for QR code generation.
    /// </summary>
    /// <returns>Tuple containing the request ID and public key hash.</returns>
    /// <exception cref="MobileLoginException">Thrown when the request fails.</exception>
    public async Task<(string RequestId, string PublicKeyHash)> InitiateAsync()
    {
        try
        {
            // Generate RSA key pair
            var keyPair = await _jsInteropService.GenerateRsaKeyPair();
            _privateKey = keyPair.PrivateKey;

            // Compute hash of public key for QR code binding
            // This allows mobile app to verify the public key hasn't been swapped by the server
            _publicKeyHash = ComputePublicKeyHash(keyPair.PublicKey);

            // Send public key to server
            var request = new MobileLoginInitiateRequest
            {
                ClientPublicKey = keyPair.PublicKey,
            };
            var response = await _httpClient.PostAsJsonAsync("v1/Auth/mobile-login/initiate", request);

            if (!response.IsSuccessStatusCode)
            {
                throw new MobileLoginException(MobileLoginErrorCode.Generic);
            }

            var result = await response.Content.ReadFromJsonAsync<MobileLoginInitiateResponse>();
            if (result == null)
            {
                throw new MobileLoginException(MobileLoginErrorCode.Generic);
            }

            _requestId = result.RequestId;
            return (_requestId, _publicKeyHash);
        }
        catch (MobileLoginException)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to initiate mobile login");
            throw new MobileLoginException(MobileLoginErrorCode.Generic);
        }
    }

    /// <summary>
    /// Starts polling the server for mobile login response.
    /// </summary>
    /// <param name="onSuccess">Callback for successful authentication with decrypted login result.</param>
    /// <param name="onError">Callback for errors with error code.</param>
    /// <returns>Task.</returns>
    public Task StartPollingAsync(Func<MobileLoginResult, Task> onSuccess, Action<MobileLoginErrorCode> onError)
    {
        if (string.IsNullOrEmpty(_requestId) || string.IsNullOrEmpty(_privateKey))
        {
            throw new InvalidOperationException("Must call InitiateAsync() before starting polling");
        }

        _cancellationTokenSource = new CancellationTokenSource();

        // Start polling timer (every 3 seconds)
        _pollingTimer = new Timer(async _ => await PollServerAsync(onSuccess, onError), null, TimeSpan.Zero, TimeSpan.FromSeconds(3));

        // Auto-stop after 3.5 minutes (adds 1 minute buffer to default 2 minute timer for edge cases)
        Task.Delay(TimeSpan.FromSeconds(210), _cancellationTokenSource.Token)
            .ContinueWith(
                _ =>
                {
                    if (!_cancellationTokenSource.IsCancellationRequested)
                    {
                        StopPolling();
                        onError(MobileLoginErrorCode.Timeout);
                    }
                },
                TaskScheduler.Default);

        return Task.CompletedTask;
    }

    /// <summary>
    /// Stops polling the server.
    /// </summary>
    public void StopPolling()
    {
        _pollingTimer?.Dispose();
        _pollingTimer = null;
        _cancellationTokenSource?.Cancel();
        _cancellationTokenSource?.Dispose();
        _cancellationTokenSource = null;
    }

    /// <summary>
    /// Cleans up resources.
    /// </summary>
    public void Cleanup()
    {
        StopPolling();
        _privateKey = null;
        _requestId = null;
        _publicKeyHash = null;
    }

    /// <inheritdoc/>
    public void Dispose()
    {
        Cleanup();
    }

    /// <summary>
    /// Computes a SHA-256 hash of the public key and returns the first 16 characters.
    /// </summary>
    /// <param name="publicKey">The public key to hash.</param>
    /// <returns>First 16 characters of the hex-encoded SHA-256 hash.</returns>
    private static string ComputePublicKeyHash(string publicKey)
    {
        var bytes = Encoding.UTF8.GetBytes(publicKey);
        var hashBytes = SHA256.HashData(bytes);
        var hashHex = Convert.ToHexString(hashBytes).ToLowerInvariant();

        // Return first 16 characters for a compact but secure fingerprint
        return hashHex[..16];
    }

    private async Task PollServerAsync(Func<MobileLoginResult, Task> onSuccess, Action<MobileLoginErrorCode> onError)
    {
        if (string.IsNullOrEmpty(_requestId) || _cancellationTokenSource?.IsCancellationRequested == true)
        {
            return;
        }

        try
        {
            var response = await _httpClient.GetAsync($"v1/Auth/mobile-login/poll/{_requestId}");

            if (!response.IsSuccessStatusCode)
            {
                if (response.StatusCode == System.Net.HttpStatusCode.NotFound)
                {
                    StopPolling();
                    _privateKey = null;
                    _requestId = null;
                    onError(MobileLoginErrorCode.Timeout);
                    return;
                }

                throw new InvalidOperationException($"Polling failed: {response.StatusCode}");
            }

            var result = await response.Content.ReadFromJsonAsync<MobileLoginPollResponse>();

            if (result?.Fulfilled == true && !string.IsNullOrEmpty(result.EncryptedSymmetricKey))
            {
                // Stop polling
                StopPolling();

                // Decrypt the vault decryption key directly with RSA private key
                var decryptionKey = await _jsInteropService.DecryptWithPrivateKey(result.EncryptedDecryptionKey!, _privateKey!);

                // Decrypt the symmetric key with RSA private key
                var symmetricKeyBase64 = await _jsInteropService.DecryptWithPrivateKey(result.EncryptedSymmetricKey, _privateKey!);

                // Decrypt all remaining fields using the symmetric key
                var token = await _jsInteropService.SymmetricDecrypt(result.EncryptedToken!, symmetricKeyBase64);
                var refreshToken = await _jsInteropService.SymmetricDecrypt(result.EncryptedRefreshToken!, symmetricKeyBase64);
                var username = await _jsInteropService.SymmetricDecrypt(result.EncryptedUsername!, symmetricKeyBase64);

                // Clear sensitive data
                _privateKey = null;
                _requestId = null;

                // Call success callback with decrypted data
                await onSuccess(new MobileLoginResult
                {
                    Username = username,
                    Token = token,
                    RefreshToken = refreshToken,
                    DecryptionKey = decryptionKey,
                });
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error during mobile login polling");
            StopPolling();
            _privateKey = null;
            _requestId = null;
            onError(MobileLoginErrorCode.Generic);
        }
    }
}
