//-----------------------------------------------------------------------
// <copyright file="RequestClientInfo.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Auth;

using Microsoft.AspNetCore.Http;

/// <summary>
/// Describes the client behind a request from its headers. 
/// </summary>
public static class RequestClientInfo
{
    /// <summary>
    /// Determines the type of device based on the User-Agent header.
    /// </summary>
    /// <param name="context">The HttpContext containing the request information.</param>
    /// <returns>"Mobile", "Tablet", "Smart TV" or "Desktop".</returns>
    public static string? DetermineDeviceType(HttpContext? context)
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
    /// <returns>"Windows", "MacOS", "Linux", "Android", "iOS" or null when unknown.</returns>
    public static string? DetermineOperatingSystem(HttpContext? context)
    {
        if (context is null)
        {
            return null;
        }

        // Android and iOS user agents also name Linux and Mac OS X, so they are matched first.
        return context.Request.Headers.UserAgent.ToString().ToLower() switch
        {
            var ua when ua.Contains("android") => "Android",
            var ua when ua.Contains("iphone") || ua.Contains("ipad") => "iOS",
            var ua when ua.Contains("win") => "Windows",
            var ua when ua.Contains("mac") => "MacOS",
            var ua when ua.Contains("linux") => "Linux",
            _ => null,
        };
    }

    /// <summary>
    /// Determines the browser type based on the User-Agent header.
    /// </summary>
    /// <param name="context">The HttpContext containing the request information.</param>
    /// <returns>"Firefox", "Chrome", "Safari", "Edge", "Opera" or null when unknown.</returns>
    public static string? DetermineBrowser(HttpContext? context)
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
    /// Determines the country of the request. Returns null until a Geo-IP database or service is available.
    /// </summary>
    /// <returns>The country, or null when it cannot be determined.</returns>
    public static string? DetermineCountry()
    {
        return null;
    }
}
