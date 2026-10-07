//-----------------------------------------------------------------------
// <copyright file="BinaryFrame.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Helpers;

using System.Buffers.Binary;
using System.Text.Json;

/// <summary>
/// Writes the binary body of the v2 vault downloads: a 4-byte big-endian header length, the header as UTF-8 JSON, then
/// the raw ciphertexts back to back. The header carries each ciphertext's size, in the order the bytes follow.
/// </summary>
public static class BinaryFrame
{
    /// <summary>
    /// The media type of a binary frame.
    /// </summary>
    public const string ContentType = "application/octet-stream";

    /// <summary>
    /// Builds a frame from a header and the ciphertexts that follow it.
    /// </summary>
    /// <param name="header">The JSON header.</param>
    /// <param name="parts">The ciphertexts, in the order the header lists their sizes.</param>
    /// <returns>The frame bytes.</returns>
    public static byte[] Write(object header, IReadOnlyList<byte[]> parts)
    {
        var headerBytes = JsonSerializer.SerializeToUtf8Bytes(header, JsonSerializerOptions.Web);
        var body = new byte[4 + headerBytes.Length + parts.Sum(p => p.Length)];
        BinaryPrimitives.WriteUInt32BigEndian(body, (uint)headerBytes.Length);
        headerBytes.CopyTo(body, 4);
        var offset = 4 + headerBytes.Length;
        foreach (var part in parts)
        {
            part.CopyTo(body, offset);
            offset += part.Length;
        }

        return body;
    }
}
