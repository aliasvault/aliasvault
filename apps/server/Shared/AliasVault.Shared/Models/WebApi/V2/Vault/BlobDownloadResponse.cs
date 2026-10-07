//-----------------------------------------------------------------------
// <copyright file="BlobDownloadResponse.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Vault;

using System.Text.Json.Serialization;

/// <summary>
/// Response for POST /v2/Vault/blobs/download, as the JSON header of a binary frame (see <see cref="IFrameBody"/>).
/// </summary>
public class BlobDownloadResponse : IFrameBody
{
    /// <summary>Gets or sets the requested blobs the server has stored.</summary>
    public List<BlobEntry> Blobs { get; set; } = [];

    /// <inheritdoc/>
    [JsonIgnore]
    public IEnumerable<IFramePart> FrameParts => Blobs;
}
