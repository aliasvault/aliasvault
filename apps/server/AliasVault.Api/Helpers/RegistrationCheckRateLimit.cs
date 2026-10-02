//-----------------------------------------------------------------------
// <copyright file="RegistrationCheckRateLimit.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Helpers;

using System.Net;
using System.Net.Sockets;
using System.Threading.RateLimiting;
using AliasVault.Auth.IpAddress;
using AliasVault.Shared.Models.Enums;
using AliasVault.Shared.Models.WebApi;
using Microsoft.AspNetCore.RateLimiting;

/// <summary>
/// Per-IP flood limit for the anonymous registration checks (username availability, invite code).
/// </summary>
public static class RegistrationCheckRateLimit
{
    /// <summary>
    /// Name of the rate limiter policy, for <see cref="EnableRateLimitingAttribute"/>.
    /// </summary>
    public const string PolicyName = "RegistrationChecks";

    /// <summary>
    /// Requests a client can make in a burst, shared by all registration check endpoints.
    /// </summary>
    private const int BurstLimit = 30;

    /// <summary>
    /// How often a client gets one more request, which caps the sustained rate at 3 per minute.
    /// </summary>
    private static readonly TimeSpan ReplenishmentPeriod = TimeSpan.FromSeconds(20);

    /// <summary>
    /// Add the policy and the 429 response to the rate limiter options.
    /// </summary>
    /// <param name="options">The rate limiter options.</param>
    /// <param name="isDevelopment">Whether the API runs in Development, where E2E tests register in bulk from one IP and the limit is off.</param>
    public static void Configure(RateLimiterOptions options, bool isDevelopment)
    {
        options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
        options.OnRejected = async (context, cancellationToken) =>
            await context.HttpContext.Response.WriteAsJsonAsync(ApiErrorCodeHelper.CreateErrorResponse(ApiErrorCode.REGISTRATION_RATE_LIMIT_EXCEEDED, StatusCodes.Status429TooManyRequests), cancellationToken);

        options.AddPolicy(PolicyName, httpContext =>
        {
            if (isDevelopment)
            {
                return RateLimitPartition.GetNoLimiter(string.Empty);
            }

            return RateLimitPartition.GetTokenBucketLimiter(GetClientKey(httpContext), _ => new TokenBucketRateLimiterOptions
            {
                TokenLimit = BurstLimit,
                TokensPerPeriod = 1,
                ReplenishmentPeriod = ReplenishmentPeriod,
                QueueLimit = 0,
            });
        });
    }

    /// <summary>
    /// The client IP as partition key, IPv6 reduced to its /64 since a single client usually controls a whole /64.
    /// </summary>
    private static string GetClientKey(HttpContext httpContext)
    {
        var ip = IpAddressUtility.GetRawIpAddressFromContext(httpContext);
        if (ip is null)
        {
            return "unknown";
        }

        if (ip.AddressFamily == AddressFamily.InterNetworkV6)
        {
            var bytes = ip.GetAddressBytes();
            Array.Clear(bytes, 8, 8);
            return new IPAddress(bytes).ToString();
        }

        return ip.ToString();
    }
}
