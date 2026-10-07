//-----------------------------------------------------------------------
// <copyright file="BinaryFrame.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Helpers;

using System.Buffers.Binary;
using System.Text.Json;
using AliasVault.Shared.Models.WebApi.V2.Vault;

/// <summary>
/// The binary body of the v2 vault transfers: a 4-byte big-endian header length, a UTF-8 JSON header, then the raw
/// ciphertexts. Each <see cref="IFramePart"/> in the header gives the offset (counted from the first byte after the
/// header) and size of its ciphertext, so readers skip entries and bytes they do not know.
/// </summary>
public static class BinaryFrame
{
    /// <summary>
    /// The media type of a binary frame.
    /// </summary>
    public const string ContentType = "application/octet-stream";

    /// <summary>
    /// Builds a frame from a header, setting each part's offset and size.
    /// </summary>
    /// <param name="header">The JSON header.</param>
    /// <returns>The frame bytes.</returns>
    public static byte[] Write(IFrameBody header)
    {
        var partList = header.FrameParts.ToList();
        var dataLength = 0;
        foreach (var part in partList)
        {
            part.Offset = dataLength;
            part.Size = part.Data.Length;
            dataLength += part.Data.Length;
        }

        var headerBytes = JsonSerializer.SerializeToUtf8Bytes(header, header.GetType(), JsonSerializerOptions.Web);
        var dataStart = 4 + headerBytes.Length;
        var body = new byte[dataStart + dataLength];
        BinaryPrimitives.WriteUInt32BigEndian(body, (uint)headerBytes.Length);
        headerBytes.CopyTo(body, 4);
        foreach (var part in partList)
        {
            part.Data.CopyTo(body, dataStart + part.Offset);
        }

        return body;
    }
}
