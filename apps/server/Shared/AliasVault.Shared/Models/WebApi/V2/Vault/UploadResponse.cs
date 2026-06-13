//-----------------------------------------------------------------------
// <copyright file="UploadResponse.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Vault;

using AliasVault.Shared.Models.Enums;

/// <summary>
/// Response for POST /v2/Vault.
/// </summary>
public class UploadResponse
{
    /// <summary>Gets or sets the status.</summary>
    public required VaultStatus Status { get; set; }

    /// <summary>Gets or sets the new manifest revision number assigned by the server (or the latest if Outdated).</summary>
    public required long NewManifestRevision { get; set; }

    /// <summary>Gets or sets the new revision for each uploaded data-bucket kind. Empty if none included.</summary>
    public List<BucketRevision> NewBucketRevisions { get; set; } = [];

    /// <summary>Gets or sets blob hashes the client claimed in BlobReferences but the server didn't find. Client should
    /// re-upload these in NewBlobs and retry.</summary>
    public List<string> MissingBlobHashes { get; set; } = [];
}
