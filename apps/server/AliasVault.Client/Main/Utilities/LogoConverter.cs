//-----------------------------------------------------------------------
// <copyright file="LogoConverter.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Main.Utilities;

using System;
using System.Text;

/// <summary>
/// Converts raw logo bytes into a data URI suitable for use as an img src value.
/// </summary>
public static class LogoConverter
{
    /// <summary>
    /// Converts the given logo bytes into a data URI. Returns null for null/empty input.
    /// </summary>
    /// <param name="bytes">The raw logo bytes.</param>
    /// <returns>A data URI string, or null when the input is null or empty.</returns>
    public static string? ToDataUri(byte[]? bytes)
    {
        if (bytes is null || bytes.Length == 0)
        {
            return null;
        }

        var mimeType = DetectMimeType(bytes);
        var base64 = Convert.ToBase64String(bytes);
        return $"data:{mimeType};base64,{base64}";
    }

    /// <summary>
    /// Detect MIME type from file signature (magic numbers).
    /// </summary>
    /// <param name="bytes">The bytes to inspect.</param>
    /// <returns>A best-guess MIME type for the bytes.</returns>
    private static string DetectMimeType(byte[] bytes)
    {
        if (bytes.Length >= 5)
        {
            var header = Encoding.UTF8.GetString(bytes, 0, 5).ToLowerInvariant();
            if (header.Contains("<?xml") || header.Contains("<svg"))
            {
                return "image/svg+xml";
            }
        }

        if (bytes.Length >= 4)
        {
            if (bytes[0] == 0x00 && bytes[1] == 0x00 && bytes[2] == 0x01 && bytes[3] == 0x00)
            {
                return "image/x-icon";
            }

            if (bytes[0] == 0x89 && bytes[1] == 0x50 && bytes[2] == 0x4E && bytes[3] == 0x47)
            {
                return "image/png";
            }

            if (bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes[2] == 0xFF)
            {
                return "image/jpeg";
            }
        }

        return "image/x-icon";
    }
}
