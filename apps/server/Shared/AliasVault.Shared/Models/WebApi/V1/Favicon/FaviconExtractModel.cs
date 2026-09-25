//-----------------------------------------------------------------------
// <copyright file="FaviconExtractModel.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V1.Favicon;

/// <summary>
/// FaviconExtractModel model.
/// </summary>
public class FaviconExtractModel
{
    /// <summary>
    /// Gets or sets favicon image as byte array.
    /// </summary>
    public byte[]? Image { get; set; } = null!;
}
