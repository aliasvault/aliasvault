//-----------------------------------------------------------------------
// <copyright file="AliasVaultApiHandlerService.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Services.Auth;

using System.Net;
using System.Net.Http.Headers;
using Microsoft.AspNetCore.Components;
using Microsoft.Extensions.Localization;

/// <summary>
/// This services handles all API requests to the AliasVault API and will add the access token to the request headers.
/// If a 401 unauthorized is returned by the API it will intercept this response and attempt to automatically refresh the access token.
/// </summary>
/// <param name="serviceProvider">IServiceProvider instance.</param>
public sealed class AliasVaultApiHandlerService(IServiceProvider serviceProvider) : DelegatingHandler
{
    /// <summary>
    /// Override the SendAsync method to add the access token to the request headers.
    /// </summary>
    /// <param name="request">HttpRequestMessage instance.</param>
    /// <param name="cancellationToken">CancellationToken instance.</param>
    /// <returns>HttpResponseMessage.</returns>
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        // Check if the request already contains the refreshed token to prevent infinite loop
        if (request.Headers.Contains("X-Ignore-Failure"))
        {
            // Remove the header to avoid sending it with the final request
            request.Headers.Remove("X-Ignore-Failure");
            return await base.SendAsync(request, cancellationToken);
        }

        // Set the access token in the Authorization header
        var authService = serviceProvider.GetRequiredService<AuthService>();
        var token = await authService.GetAccessTokenAsync();
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await base.SendAsync(request, cancellationToken);
        if (response.StatusCode == HttpStatusCode.UpgradeRequired)
        {
            // The server rejects clients it no longer supports with HTTP 426 on any endpoint: forced logout.
            var logger = serviceProvider.GetRequiredService<ILogger<AliasVaultApiHandlerService>>();
            logger.LogError("Server refused this client version (HTTP 426), redirect to login.");

            await authService.RemoveTokensAsync();

            var localizer = serviceProvider.GetRequiredService<IStringLocalizerFactory>().Create("SharedResources", "AliasVault.Client");
            var globalNotificationService = serviceProvider.GetRequiredService<GlobalNotificationService>();
            globalNotificationService.AddErrorMessage(localizer["ClientVersionUnsupported"]);
            var navigationManager = serviceProvider.GetRequiredService<NavigationManager>();
            navigationManager.NavigateTo("/user/login");
            return response;
        }

        if (response.StatusCode == HttpStatusCode.Unauthorized)
        {
            // Call the refresh token endpoint to get a new access token
            var newToken = await authService.RefreshTokenAsync();

            if (!string.IsNullOrEmpty(newToken))
            {
                // Retry the original request with the new access token
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", newToken);

                // Add a custom header to indicate that the next request is a retry attempt and any failure should be ignored.
                request.Headers.Add("X-Ignore-Failure", "true");
                response = await base.SendAsync(request, cancellationToken);
                return response;
            }

            var logger = serviceProvider.GetRequiredService<ILogger<AliasVaultApiHandlerService>>();
            logger.LogError("Failed to refresh token, redirect to login.");

            // Refreshing token failed. This might be caused by the expiration or revocation of the refresh token itself.
            // Remove the token from local storage and redirect to the login page.
            await authService.RemoveTokensAsync();

            var globalNotificationService = serviceProvider.GetRequiredService<GlobalNotificationService>();
            globalNotificationService.AddErrorMessage("Your session has expired. Please log in again.");
            var navigationManager = serviceProvider.GetRequiredService<NavigationManager>();
            navigationManager.NavigateTo("/user/login");
        }

        return response;
    }
}
