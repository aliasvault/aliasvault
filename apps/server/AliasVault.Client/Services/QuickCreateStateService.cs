//-----------------------------------------------------------------------
// <copyright file="QuickCreateStateService.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Services;

/// <summary>
/// Service to handle shared state for quick create form data.
/// </summary>
public class QuickCreateStateService
{
    /// <summary>
    /// Gets or sets the service name from quick create.
    /// </summary>
    public string? ServiceName { get; set; }

    /// <summary>
    /// Gets or sets the service URL from quick create.
    /// </summary>
    public string? ServiceUrl { get; set; }

    /// <summary>
    /// Gets or sets the item type from quick create.
    /// </summary>
    public string? ItemType { get; set; }

    /// <summary>
    /// Gets or sets the folder ID to pre-select when creating a new item.
    /// </summary>
    public Guid? FolderId { get; set; }

    /// <summary>
    /// Clears the stored state.
    /// </summary>
    public void ClearState()
    {
        ServiceName = null;
        ServiceUrl = null;
        ItemType = null;
        FolderId = null;
    }
}
