//-----------------------------------------------------------------------
// <copyright file="StartupTasks.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Admin;

using AliasServerDb;
using Microsoft.AspNetCore.Identity;

/// <summary>
/// Startup tasks that should be run when the application starts.
/// </summary>
public static class StartupTasks
{
    /// <summary>
    /// Creates the roles if they do not exist.
    /// </summary>
    /// <param name="serviceProvider">IServiceProvider instance.</param>
    /// <returns>Task.</returns>
    public static async Task CreateRolesIfNotExist(IServiceProvider serviceProvider)
    {
        var roleManager = serviceProvider.GetRequiredService<RoleManager<AdminRole>>();

        const string adminRole = "Admin";

        if (!await roleManager.RoleExistsAsync(adminRole))
        {
            await roleManager.CreateAsync(new AdminRole(adminRole));
        }
    }

    /// <summary>
    /// Creates the admin user if it does not exist and admin password hash is configured.
    /// </summary>
    /// <param name="serviceProvider">IServiceProvider instance.</param>
    /// <returns>Async Task.</returns>
    public static async Task SetAdminUser(IServiceProvider serviceProvider)
    {
        using var scope = serviceProvider.CreateScope();
        var userManager = scope.ServiceProvider.GetRequiredService<UserManager<AdminUser>>();
        var adminUser = await userManager.FindByNameAsync("admin");
        var config = serviceProvider.GetRequiredService<Config>();

        // Skip admin user creation if no admin password hash is configured
        if (string.IsNullOrEmpty(config.AdminPasswordHash))
        {
            Console.WriteLine("Admin password hash not configured - skipping admin user creation.");
            Console.WriteLine("Run '$ aliasvault reset-admin-password' to configure the admin password.");
            return;
        }

        if (adminUser == null)
        {
            var adminPasswordHash = config.AdminPasswordHash;
            adminUser = new AdminUser();
            adminUser.UserName = "admin";

            await userManager.CreateAsync(adminUser);
            adminUser.PasswordHash = adminPasswordHash;
            adminUser.LastPasswordChanged = DateTime.UtcNow;
            await userManager.UpdateAsync(adminUser);

            Console.WriteLine("Admin user created.");
        }
        else
        {
            // Check if the password hash is different AND the hash in secret file is newer than the password of user.
            // If so, update the password hash of the user in the database so it matches the one in the admin_password_hash file.
            if (adminUser.PasswordHash != config.AdminPasswordHash && (adminUser.LastPasswordChanged is null || (config.LastPasswordChanged != DateTime.MinValue && config.LastPasswordChanged > adminUser.LastPasswordChanged)))
            {
                // The password has been changed in the .env file, update the user's password hash.
                adminUser.PasswordHash = config.AdminPasswordHash;
                adminUser.LastPasswordChanged = DateTime.UtcNow;

                // Reset 2FA settings
                adminUser.TwoFactorEnabled = false;

                // During password reset, also unblock the admin user in case it was blocked.
                adminUser.AccessFailedCount = 0;
                adminUser.LockoutEnd = null;

                // Clear existing recovery codes
                await userManager.GenerateNewTwoFactorRecoveryCodesAsync(adminUser, 0);
                await userManager.UpdateAsync(adminUser);

                Console.WriteLine("Admin password hash updated.");
            }
        }
    }
}
