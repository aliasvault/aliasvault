//-----------------------------------------------------------------------
// <copyright file="CodecOverflow.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasClientDb;

using System.ComponentModel.DataAnnotations;

/// <summary>
/// Table to store codec overflow data that cannot be materialized into the local schema.
/// </summary>
public class CodecOverflow
{
    /// <summary>
    /// Gets or sets the primary key. The codec writes a single row with a fixed sentinel id.
    /// </summary>
    [Key]
    public Guid Id { get; set; }

    /// <summary>
    /// Gets or sets the serialized overflow payload (JSON, shape owned by the Rust vault codec).
    /// </summary>
    public string Data { get; set; } = null!;
}
