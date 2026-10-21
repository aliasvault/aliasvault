//-----------------------------------------------------------------------
// <copyright file="KeyRotationRequest.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.KeyRotation;

using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;
using AliasVault.Shared.Models.WebApi.V2.Vault;

/// <summary>
/// Request for POST /v2/KeyRotation: everything a rotation of the account's keys replaces, applied in one transaction.
/// Sent as a <see cref="IFrameBody"/> because the manifest and bucket ciphertexts travel outside the JSON header.
/// </summary>
public class KeyRotationRequest : IFrameBody
{
    /// <summary>
    /// Gets or sets the client SRP ephemeral proving the current password.
    /// </summary>
    public required string CurrentClientPublicEphemeral { get; set; }

    /// <summary>
    /// Gets or sets the client SRP session proof proving the current password.
    /// </summary>
    public required string CurrentClientSessionProof { get; set; }

    /// <summary>
    /// Gets or sets the server state the client re-encrypted from; any difference refuses the whole rotation.
    /// </summary>
    public required KeyRotationExpectedState Expected { get; set; }

    /// <summary>
    /// Gets or sets the master-password unlock method that opens the new Account Key.
    /// </summary>
    public required KeyRotationUnlockMethod UnlockMethod { get; set; }

    /// <summary>
    /// Gets or sets the new account keys.
    /// </summary>
    public required KeyRotationAccountKeys AccountKeys { get; set; }

    /// <summary>
    /// Gets or sets the personal manifest, encrypted with the new VEK.
    /// </summary>
    public required ManifestWrite Manifest { get; set; }

    /// <summary>
    /// Gets or sets every data bucket of the personal manifest, encrypted with the new VEK.
    /// </summary>
    [MaxLength(VaultWriteLimits.MaxBucketsPerWrite)]
    public List<BucketWrite> Buckets { get; set; } = [];

    /// <summary>
    /// Gets or sets the blob key of every blob the personal manifest references, encrypted with the new VEK.
    /// </summary>
    [MaxLength(VaultWriteLimits.MaxBlobReferencesPerManifest)]
    public List<BlobKeyRewrap> BlobKeys { get; set; } = [];

    /// <summary>
    /// Gets or sets every shared-vault grant the caller holds, encrypted for the new account public key.
    /// </summary>
    public List<GrantRewrap> Grants { get; set; } = [];

    /// <summary>
    /// Gets or sets every key certification the caller made, signed again with the new signing key.
    /// </summary>
    public List<CertificationRewrap> Certifications { get; set; } = [];

    /// <inheritdoc />
    [JsonIgnore]
    public IEnumerable<IFramePart> FrameParts => new IFramePart[] { Manifest }.Concat(Buckets);
}
