//-----------------------------------------------------------------------
// <copyright file="TaskRunnerJob.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasServerDb;

using System;
using System.ComponentModel.DataAnnotations;
using AliasVault.Shared.Models.Enums;

/// <summary>
/// Represents a task runner job entry in the AliasServerDb.
/// </summary>
public class TaskRunnerJob
{
    /// <summary>
    /// Gets or sets the ID of the task runner job.
    /// </summary>
    [Key]
    public int Id { get; set; }

    /// <summary>
    /// Gets or sets the name of the task runner job.
    /// </summary>
    [Required]
    [MaxLength(50)]
    public string Name { get; set; } = null!;

    /// <summary>
    /// Gets or sets the date the job was run.
    /// </summary>
    public DateTime RunDate { get; set; }

    /// <summary>
    /// Gets or sets the start time of the job.
    /// </summary>
    public TimeOnly StartTime { get; set; }

    /// <summary>
    /// Gets or sets the end time of the job.
    /// </summary>
    public TimeOnly? EndTime { get; set; }

    /// <summary>
    /// Gets or sets the status of the job.
    /// </summary>
    public TaskRunnerJobStatus Status { get; set; }

    /// <summary>
    /// Gets or sets the error message of the job.
    /// </summary>
    public string? ErrorMessage { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether this is an on-demand run.
    /// </summary>
    public bool IsOnDemand { get; set; }
}
