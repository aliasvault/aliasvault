//-----------------------------------------------------------------------
// <copyright file="ManifestAccessScope.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Models;

/// <summary>
/// The two arms of the manifest access rule resolved to constants.
/// </summary>
/// <param name="PersonalGroupId">The caller's personal group.</param>
/// <param name="GrantedManifestIds">The manifests the caller holds a grant key on.</param>
public readonly record struct ManifestAccessScope(Guid PersonalGroupId, List<Guid> GrantedManifestIds);
