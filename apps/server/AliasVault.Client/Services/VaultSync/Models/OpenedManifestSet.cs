//-----------------------------------------------------------------------
// <copyright file="OpenedManifestSet.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Services.VaultSync.Models;

/// <summary>
/// Every manifest of one snapshot, decrypted and ready to materialize.
/// </summary>
/// <param name="Resolved">The opened manifests, personal first.</param>
/// <param name="DataBuckets">The decrypted data bucket payloads (JSON).</param>
/// <param name="ContentlessManifestIds">Shared manifests served without content (granted but never written).</param>
/// <param name="PersonalRevision">The personal manifest's revision.</param>
internal sealed record OpenedManifestSet(List<ResolvedManifest> Resolved, List<string> DataBuckets, List<Guid> ContentlessManifestIds, long PersonalRevision);
