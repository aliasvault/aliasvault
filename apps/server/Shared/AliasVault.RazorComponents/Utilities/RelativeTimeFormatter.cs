//-----------------------------------------------------------------------
// <copyright file="RelativeTimeFormatter.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.RazorComponents.Utilities;

/// <summary>
/// Utility for formatting DateTime values as relative time strings (e.g., "5 minutes ago", "2 days ago").
/// </summary>
public static class RelativeTimeFormatter
{
    /// <summary>
    /// Formats a DateTime as a relative time string.
    /// </summary>
    /// <param name="dateTime">The DateTime to format (assumed to be UTC).</param>
    /// <returns>A human-readable relative time string.</returns>
    public static string Format(DateTime dateTime)
    {
        var now = DateTime.UtcNow;
        var timeSpan = now - dateTime;

        if (timeSpan.TotalSeconds < 0)
        {
            return "just now";
        }

        if (timeSpan.TotalSeconds < 60)
        {
            var seconds = (int)timeSpan.TotalSeconds;
            return seconds <= 5 ? "just now" : $"{seconds} sec ago";
        }

        if (timeSpan.TotalMinutes < 60)
        {
            var minutes = (int)timeSpan.TotalMinutes;
            return minutes == 1 ? "1 min ago" : $"{minutes} min ago";
        }

        if (timeSpan.TotalHours < 24)
        {
            var hours = (int)timeSpan.TotalHours;
            return hours == 1 ? "1 hour ago" : $"{hours} hours ago";
        }

        if (timeSpan.TotalDays < 30)
        {
            var days = (int)timeSpan.TotalDays;
            return days == 1 ? "1 day ago" : $"{days} days ago";
        }

        if (timeSpan.TotalDays < 365)
        {
            var months = (int)(timeSpan.TotalDays / 30);
            return months == 1 ? "1 month ago" : $"{months} months ago";
        }

        var years = (int)(timeSpan.TotalDays / 365);
        return years == 1 ? "1 year ago" : $"{years} years ago";
    }

    /// <summary>
    /// Formats a nullable DateTime as a relative time string.
    /// </summary>
    /// <param name="dateTime">The nullable DateTime to format.</param>
    /// <param name="fallback">The fallback string to use if dateTime is null.</param>
    /// <returns>A human-readable relative time string or the fallback value.</returns>
    public static string Format(DateTime? dateTime, string fallback = "Never")
    {
        return dateTime.HasValue ? Format(dateTime.Value) : fallback;
    }
}
