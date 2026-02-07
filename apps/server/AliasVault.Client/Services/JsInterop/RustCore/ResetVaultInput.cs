//-----------------------------------------------------------------------
// <copyright file="ResetVaultInput.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Services.JsInterop.RustCore;

/// <summary>
/// Input structure for vault reset operation.
/// </summary>
public class ResetVaultInput
{
    /// <summary>
    /// Gets or sets the current time in ISO 8601 format (YYYY-MM-DDTHH:MM:SS.sssZ).
    /// Required: caller must always provide the current UTC time.
    /// Use DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ") to generate this value.
    /// </summary>
    public string CurrentTime { get; set; } = string.Empty;
}
