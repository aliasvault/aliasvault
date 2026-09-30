//-----------------------------------------------------------------------
// <copyright file="Program.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

using AliasServerDb;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore.Metadata;

// Add return type for top-level statements
return Run(args);

/// <summary>
/// Handles the migration of data between SQLite and PostgreSQL databases and password hashing utilities.
/// </summary>
public static partial class Program
{
    /// <summary>
    /// Runs the program with the given arguments.
    /// </summary>
    /// <param name="args">The command-line arguments.</param>
    /// <returns>The exit code of the program.</returns>
    public static int Run(string[] args)
    {
        if (args.Length == 0)
        {
            Console.WriteLine("Usage:");
            Console.WriteLine("  hash-password <password>");
            return 1;
        }

        switch (args[0].ToLower())
        {
            case "hash-password":
                if (args.Length != 2)
                {
                    Console.WriteLine("Usage: hash-password <password>");
                    return 1;
                }

                return HashPassword(args[1]);

            default:
                Console.WriteLine("Unknown command. Available commands:");
                Console.WriteLine("  hash-password <password>");
                return 1;
        }
    }

    /// <summary>
    /// Hashes a password using ASP.NET Core Identity's password hasher.
    /// </summary>
    /// <param name="password">The plain text password to hash.</param>
    /// <returns>
    /// Returns 0 if the password was successfully hashed and printed to console.
    /// </returns>
    private static int HashPassword(string password)
    {
        var hasher = new PasswordHasher<IdentityUser>();
        var user = new AdminUser();
        var hashedPassword = hasher.HashPassword(user, password);
        Console.WriteLine(hashedPassword);
        return 0;
    }
}
