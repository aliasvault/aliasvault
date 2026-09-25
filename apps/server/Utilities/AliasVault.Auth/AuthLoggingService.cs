//-----------------------------------------------------------------------
// <copyright file="AuthLoggingService.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Auth;

using AliasServerDb;
using AliasVault.Auth.IpAddress;
using AliasVault.Shared.Models.Configuration;
using AliasVault.Shared.Models.Enums;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

/// <summary>
/// Auth logging service for logging authentication events such as user login attempts.
/// </summary>
/// <param name="serviceProvider">IServiceProvider instance.</param>
/// <param name="httpContextAccessor">IHttpContextAccessor instance.</param>
public class AuthLoggingService(IServiceProvider serviceProvider, IHttpContextAccessor httpContextAccessor)
{
    /// <summary>
    /// Logs a successful auth event.
    /// </summary>
    /// <param name="username">Username of login attempt.</param>
    /// <param name="eventType">The type of auth event.</param>
    public async Task LogAuthEventSuccessAsync(string username, AuthEventType eventType)
    {
        using var scope = serviceProvider.CreateScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<AliasServerDbContext>();

        var httpContext = httpContextAccessor.HttpContext;
        var clientHeader = httpContext?.Request.Headers["X-AliasVault-Client"].FirstOrDefault();

        var config = scope.ServiceProvider.GetRequiredService<SharedConfig>();
        var ipAddress = IpAddressUtility.GetAnonymizedIpFromContext(httpContext, config.IpLoggingEnabled);

        var authAttempt = new AuthLog
        {
            Timestamp = DateTime.UtcNow,
            Username = username,
            EventType = eventType,
            IsSuccess = true,
            FailureReason = null,
            IpAddress = ipAddress,
            Client = Truncate(clientHeader, AuthLog.ClientMaxLength),
            RequestPath = Truncate(httpContext?.Request.Path.Value, AuthLog.RequestPathMaxLength),
            DeviceType = RequestClientInfo.DetermineDeviceType(httpContext),
            OperatingSystem = RequestClientInfo.DetermineOperatingSystem(httpContext),
            Browser = RequestClientInfo.DetermineBrowser(httpContext),
            Country = RequestClientInfo.DetermineCountry(),
            IsSuspiciousActivity = false,
        };

        dbContext.AuthLogs.Add(authAttempt);

        // Update user's last activity date.
        var user = await dbContext.AliasVaultUsers.FirstOrDefaultAsync(u => u.UserName == username);
        if (user != null)
        {
            user.LastActivityDate = DateTime.UtcNow;
        }

        await dbContext.SaveChangesAsync();
    }

    /// <summary>
    /// Logs an unsuccessful (failed) authentication attempt.
    /// </summary>
    /// <param name="username">Username of login attempt.</param>
    ///  <param name="eventType">The type of auth event.</param>
    /// <param name="failureReason">Reason of failure. Defaults to AuthFailureReason.None to indicate success.</param>
    public async Task LogAuthEventFailAsync(string username, AuthEventType eventType, AuthFailureReason failureReason)
    {
        using var scope = serviceProvider.CreateScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<AliasServerDbContext>();

        var httpContext = httpContextAccessor.HttpContext;
        var clientHeader = httpContext?.Request.Headers["X-AliasVault-Client"].FirstOrDefault();

        var config = httpContext?.RequestServices.GetService<SharedConfig>();
        var ipAddress = IpAddressUtility.GetAnonymizedIpFromContext(httpContext, config?.IpLoggingEnabled == true);

        var authAttempt = new AuthLog
        {
            Timestamp = DateTime.UtcNow,
            Username = username,
            EventType = eventType,
            IsSuccess = false,
            FailureReason = failureReason,
            IpAddress = ipAddress,
            Client = Truncate(clientHeader, AuthLog.ClientMaxLength),
            RequestPath = Truncate(httpContext?.Request.Path.Value, AuthLog.RequestPathMaxLength),
            DeviceType = RequestClientInfo.DetermineDeviceType(httpContext),
            OperatingSystem = RequestClientInfo.DetermineOperatingSystem(httpContext),
            Browser = RequestClientInfo.DetermineBrowser(httpContext),
            Country = RequestClientInfo.DetermineCountry(),
            IsSuspiciousActivity = false,
        };

        dbContext.AuthLogs.Add(authAttempt);
        await dbContext.SaveChangesAsync();
    }

    /// <summary>
    /// Truncates a request-supplied value to its column's maximum length, so an oversized value never breaks the operation being logged.
    /// </summary>
    /// <param name="value">The value to store.</param>
    /// <param name="maxLength">The column's maximum length.</param>
    /// <returns>The value, cut down to the maximum length when longer.</returns>
    private static string? Truncate(string? value, int maxLength) => value is not null && value.Length > maxLength ? value[..maxLength] : value;
}
