//-----------------------------------------------------------------------
// <copyright file="AntiforgeryTokenMiddleware.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Admin.Middleware;

using System.Security.Cryptography;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.WebUtilities;

/// <summary>
/// Middleware that handles antiforgery token validation failures gracefully.
/// When an antiforgery token cannot be decrypted (e.g., after container restart with new keys),
/// this middleware clears the invalid cookie and redirects to allow a fresh start.
/// </summary>
public class AntiforgeryTokenMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ILogger<AntiforgeryTokenMiddleware> _logger;
    private readonly IDataProtectionProvider _dataProtectionProvider;

    /// <summary>
    /// Initializes a new instance of the <see cref="AntiforgeryTokenMiddleware"/> class.
    /// </summary>
    /// <param name="next">The next middleware in the pipeline.</param>
    /// <param name="logger">The logger instance.</param>
    /// <param name="dataProtectionProvider">The data protection provider.</param>
    public AntiforgeryTokenMiddleware(
        RequestDelegate next,
        ILogger<AntiforgeryTokenMiddleware> logger,
        IDataProtectionProvider dataProtectionProvider)
    {
        _next = next;
        _logger = logger;
        _dataProtectionProvider = dataProtectionProvider;
    }

    /// <summary>
    /// Invokes the middleware.
    /// </summary>
    /// <param name="context">The HTTP context.</param>
    /// <returns>A task representing the asynchronous operation.</returns>
    public async Task InvokeAsync(HttpContext context)
    {
        // Check if we have any antiforgery cookies and if they can be decrypted
        var antiforgeryCookies = context.Request.Cookies
            .Where(c => c.Key.StartsWith(".AspNetCore.Antiforgery", StringComparison.OrdinalIgnoreCase))
            .ToList();

        if (antiforgeryCookies.Count > 0)
        {
            // Try to verify we can decrypt the cookie using the data protection provider
            // If we can't, clear the cookies and redirect
            var protector = _dataProtectionProvider.CreateProtector("Microsoft.AspNetCore.Antiforgery.AntiforgeryToken.v1");

            foreach (var cookie in antiforgeryCookies)
            {
                try
                {
                    // Try to unprotect the cookie value - this will throw if the key is not found
                    var cookieValue = cookie.Value;
                    if (!string.IsNullOrEmpty(cookieValue))
                    {
                        // The cookie value is base64url encoded, try to decode and unprotect
                        var bytes = WebEncoders.Base64UrlDecode(cookieValue);
                        protector.Unprotect(bytes);
                    }
                }
                catch (CryptographicException ex)
                {
                    _logger.LogWarning(
                        "Invalid antiforgery cookie detected (cannot decrypt). Clearing cookies and redirecting. Path: {Path}, Error: {Error}",
                        context.Request.Path,
                        ex.Message);

                    ClearCookiesAndRedirect(context);
                    return;
                }
                catch (FormatException)
                {
                    // Cookie value is not valid base64, clear it
                    _logger.LogWarning(
                        "Invalid antiforgery cookie format detected. Clearing cookies and redirecting. Path: {Path}",
                        context.Request.Path);

                    ClearCookiesAndRedirect(context);
                    return;
                }
                catch (Exception ex)
                {
                    // Any other exception during decryption, clear cookies
                    _logger.LogWarning(
                        ex,
                        "Error validating antiforgery cookie. Clearing cookies and redirecting. Path: {Path}",
                        context.Request.Path);

                    ClearCookiesAndRedirect(context);
                    return;
                }
            }
        }

        await _next(context);
    }

    /// <summary>
    /// Clears antiforgery and identity cookies and redirects to the same path.
    /// </summary>
    /// <param name="context">The HTTP context.</param>
    private void ClearCookiesAndRedirect(HttpContext context)
    {
        // Clear the antiforgery cookies
        foreach (var cookie in context.Request.Cookies)
        {
            if (cookie.Key.StartsWith(".AspNetCore.Antiforgery", StringComparison.OrdinalIgnoreCase))
            {
                context.Response.Cookies.Delete(cookie.Key);
            }
        }

        // Also clear Identity cookies to ensure clean state
        foreach (var cookie in context.Request.Cookies)
        {
            if (cookie.Key.StartsWith(".AspNetCore.Identity", StringComparison.OrdinalIgnoreCase))
            {
                context.Response.Cookies.Delete(cookie.Key);
            }
        }

        // Redirect to the same path to get fresh tokens
        context.Response.Redirect(context.Request.Path + context.Request.QueryString);
    }
}
