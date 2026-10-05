//-----------------------------------------------------------------------
// <copyright file="MemberPublicKey.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Models;

/// <summary>
/// The public key a shared manifest's key is encrypted for when it is handed to somebody.
/// </summary>
/// <param name="PublicKeyId">The id of the key row.</param>
/// <param name="PublicKey">The public key itself (JWK).</param>
/// <param name="PublicKeySignature">The member's signature over <paramref name="PublicKey"/>.</param>
/// <param name="SigningPublicKey">The member's signing public key the signature verifies under.</param>
public sealed record MemberPublicKey(Guid PublicKeyId, string PublicKey, string PublicKeySignature, string? SigningPublicKey);
