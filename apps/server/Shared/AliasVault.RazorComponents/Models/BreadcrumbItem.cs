//-----------------------------------------------------------------------
// <copyright file="BreadcrumbItem.cs" company="lanedirt">
// Copyright (c) lanedirt. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.RazorComponents.Models;

/// <summary>
/// Represents a breadcrumb item for the breadcrumb component.
/// </summary>
public sealed class BreadcrumbItem
{
    /// <summary>
    /// Gets or sets the display name for the breadcrumb item.
    /// </summary>
    public string? DisplayName { get; set; }

    /// <summary>
    /// Gets or sets the URL for the breadcrumb item.
    /// </summary>
    public string? Url { get; set; }
}
