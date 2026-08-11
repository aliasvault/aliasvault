//-----------------------------------------------------------------------
// <copyright file="FileHelper.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Helpers;

/// <summary>
/// File helper class.
/// </summary>
public static class FileHelper
{
    /// <summary>
    /// Calculate the size of a base64 string in kilobytes.
    /// </summary>
    /// <param name="base64String">Base64 string as input.</param>
    /// <returns>Length in kilobytes.</returns>
    public static int Base64StringToKilobytes(string base64String)
    {
        // Remove padding characters
        var base64Length = base64String.Length - base64String.Count(c => c == '=');

        // Calculate the size of the decoded data in bytes
        double decodedSizeBytes = (base64Length * 3) / 4.0;

        // Convert bytes to kilobytes
        var kilobytes = decodedSizeBytes / 1024;

        // Return the size in kilobytes as int (rounded up)
        return (int)Math.Ceiling(kilobytes);
    }

    /// <summary>
    /// Calculate the size of a raw byte payload in kilobytes.
    /// </summary>
    /// <param name="byteCount">Length of the payload in bytes.</param>
    /// <returns>Length in kilobytes.</returns>
    public static int BytesToKilobytes(int byteCount) => (int)Math.Ceiling(byteCount / 1024.0);
}
