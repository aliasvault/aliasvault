//-----------------------------------------------------------------------
// <copyright file="MaintenanceTaskRegistration.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.TaskRunner.Tasks;

/// <summary>
/// Registers the maintenance tasks the TaskRunner executes, in execution order.
/// </summary>
public static class MaintenanceTaskRegistration
{
    /// <summary>
    /// Adds all maintenance tasks to the service collection.
    /// </summary>
    /// <param name="services">The service collection.</param>
    /// <returns>The same instance, for chaining.</returns>
    public static IServiceCollection AddMaintenanceTasks(this IServiceCollection services)
    {
        services.AddTransient<IMaintenanceTask, LogCleanupTask>();
        services.AddTransient<IMaintenanceTask, RefreshTokenCleanupTask>();
        services.AddTransient<IMaintenanceTask, EmailCleanupTask>();
        services.AddTransient<IMaintenanceTask, EmailQuotaCleanupTask>();
        services.AddTransient<IMaintenanceTask, DisabledEmailCleanupTask>();
        services.AddTransient<IMaintenanceTask, OrphanedEmailCleanupTask>();
        services.AddTransient<IMaintenanceTask, UnlockKeyHistoryCleanupTask>();
        services.AddTransient<IMaintenanceTask, VaultBlobCleanupTask>();

        return services;
    }
}
