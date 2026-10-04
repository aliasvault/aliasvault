//-----------------------------------------------------------------------
// <copyright file="FakeLoginProfile.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Models;

/// <summary>
/// The SRP values a non-existent username answers with, the same on every request.
/// </summary>
/// <param name="Salt">The SRP salt.</param>
/// <param name="Verifier">The SRP verifier the server ephemeral is created from.</param>
/// <param name="SrpIdentity">The SRP identity.</param>
public sealed record FakeLoginProfile(string Salt, string Verifier, string SrpIdentity);
