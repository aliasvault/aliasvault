//-----------------------------------------------------------------------
// <copyright file="CanonicalizedBlob.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Services.VaultSync.Models;

/// <summary>
/// A blob the codec extracted while canonicalizing: its kind and plaintext bytes.
/// </summary>
/// <param name="Kind">The blob kind (favicon or attachment).</param>
/// <param name="Bytes">The plaintext bytes.</param>
internal sealed record CanonicalizedBlob(string Kind, byte[] Bytes);
