//-----------------------------------------------------------------------
// <copyright file="PushOptions.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Services.VaultSync.Models;

/// <summary>
/// How a push writes.
/// </summary>
/// <param name="CreateVaultKey">Create the account key hierarchy as part of this push (the one-time legacy migration).</param>
/// <param name="ForceFullWrite">Rewrite every manifest and bucket regardless of the content fingerprints.</param>
public sealed record PushOptions(bool CreateVaultKey = false, bool ForceFullWrite = false);
