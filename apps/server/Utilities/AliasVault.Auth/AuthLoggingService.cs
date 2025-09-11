//-----------------------------------------------------------------------
// <copyright file="AuthLoggingService.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Auth;

using AliasServerDb;
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
        var ipAddress = config.IpLoggingEnabled ? IpAddressUtility.GetIpFromContext(httpContext) : "xxx.xxx.xxx.xxx";

        var authAttempt = new AuthLog
        {
            Timestamp = DateTime.UtcNow,
            Username = username,
            EventType = eventType,
            IsSuccess = true,
            FailureReason = null,
            IpAddress = ipAddress,
            UserAgent = httpContext?.Request.Headers.UserAgent,
            Client = clientHeader,
            RequestPath = httpContext?.Request.Path,
            DeviceType = DetermineDeviceType(httpContext),
            OperatingSystem = DetermineOperatingSystem(httpContext),
            Browser = DetermineBrowser(httpContext),
            Country = DetermineCountry(),
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
        var ipAddress = config?.IpLoggingEnabled == true ? IpAddressUtility.GetIpFromContext(httpContext) : "xxx.xxx.xxx.xxx";

        var authAttempt = new AuthLog
        {
            Timestamp = DateTime.UtcNow,
            Username = username,
            EventType = eventType,
            IsSuccess = false,
            FailureReason = failureReason,
            IpAddress = ipAddress,
            UserAgent = httpContext?.Request.Headers.UserAgent,
            Client = clientHeader,
            RequestPath = httpContext?.Request.Path,
            DeviceType = DetermineDeviceType(httpContext),
            OperatingSystem = DetermineOperatingSystem(httpContext),
            Browser = DetermineBrowser(httpContext),
            Country = DetermineCountry(),
            IsSuspiciousActivity = false,
        };

        dbContext.AuthLogs.Add(authAttempt);
        await dbContext.SaveChangesAsync();
    }

    /// <summary>
    /// Determines the type of device based on the User-Agent header.
    /// </summary>
    /// <param name="context">The HttpContext containing the request information.</param>
    /// <returns>A string representing the device type: "Mobile", "Tablet", "Smart TV", "Desktop", or "Unknown".</returns>
    private static string? DetermineDeviceType(HttpContext? context)
    {
        if (context is null)
        {
            return null;
        }

        return context.Request.Headers.UserAgent.ToString().ToLower() switch
        {
            var ua when ua.Contains("mobile") || ua.Contains("android") || ua.Contains("iphone") => "Mobile",
            var ua when ua.Contains("tablet") || ua.Contains("ipad") => "Tablet",
            var ua when ua.Contains("tv") || ua.Contains("smart-tv") => "Smart TV",
            _ => "Desktop"
        };
    }

    /// <summary>
    /// Determines the operating system based on the User-Agent header.
    /// </summary>
    /// <param name="context">The HttpContext containing the request information.</param>
    /// <returns>A string representing the operating system: "Windows", "MacOS", "Linux", "Android", "iOS", or "Unknown".</returns>
    private static string? DetermineOperatingSystem(HttpContext? context)
    {
        if (context is null)
        {
            return null;
        }

        return context.Request.Headers.UserAgent.ToString().ToLower() switch
        {
            var ua when ua.Contains("win") => "Windows",
            var ua when ua.Contains("mac") => "MacOS",
            var ua when ua.Contains("linux") => "Linux",
            var ua when ua.Contains("android") => "Android",
            var ua when ua.Contains("iphone") || ua.Contains("ipad") => "iOS",
            _ => null,
        };
    }

    /// <summary>
    /// Determines the browser type based on the User-Agent header.
    /// </summary>
    /// <param name="context">The HttpContext containing the request information.</param>
    /// <returns>A string representing the browser: "Firefox", "Chrome", "Safari", "Edge", "Opera", or "Unknown".</returns>
    private static string? DetermineBrowser(HttpContext? context)
    {
        if (context is null)
        {
            return null;
        }

        return context.Request.Headers.UserAgent.ToString().ToLower() switch
        {
            var ua when ua.Contains("firefox") => "Firefox",
            var ua when ua.Contains("chrome") && !ua.Contains("edg") => "Chrome",
            var ua when ua.Contains("safari") && !ua.Contains("chrome") => "Safari",
            var ua when ua.Contains("edg") => "Edge",
            var ua when ua.Contains("opr") || ua.Contains("opera") => "Opera",
            _ => null
        };
    }

    /// <summary>
    /// Determines the country based on the IP address of the request.
    /// </summary>
    /// <returns>A string representing the country or "Unknown" if the country cannot be determined.</returns>
    /// <remarks>
    /// This method currently returns null as the implementation is not yet complete.
    /// </remarks>
    private static string? DetermineCountry()
    {
        // Implement later by using a Geo-IP database or service.
        return null;
    }


}
