//-----------------------------------------------------------------------
// <copyright file="ButtonStyles.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Admin.Main.Components.Buttons;

/// <summary>
/// A static class that provides CSS classes for buttons.
/// </summary>
public static class ButtonStyles
{
    /// <summary>
    /// Gets the base CSS classes for buttons.
    /// </summary>
    public static string BaseClasses => "center items-center px-3 py-2 text-sm font-medium rounded-lg focus:outline-none focus:ring-4";

    /// <summary>
    /// Gets the CSS classes for a disabled button.
    /// </summary>
    public static string DisabledClasses => "bg-gray-400 cursor-not-allowed";

    /// <summary>
    /// Gets the color-specific CSS classes for a button based on the provided color.
    /// </summary>
    /// <param name="color">The color name for the button (e.g., "primary", "danger", "success", "secondary", "light").</param>
    /// <returns>A string containing the appropriate CSS classes for the specified color.</returns>
    public static string GetColorClasses(string color) => color switch
    {
        "primary" => "text-white bg-primary-700 hover:bg-primary-800 focus:ring-primary-300 dark:bg-primary-600 dark:hover:bg-primary-700 dark:focus:ring-primary-800",
        "secondary" => "text-white bg-gray-700 hover:bg-gray-800 focus:ring-gray-300 dark:bg-gray-600 dark:hover:bg-gray-700 dark:focus:ring-gray-800",
        "danger" => "text-white bg-red-700 hover:bg-red-800 focus:ring-red-300 dark:bg-red-600 dark:hover:bg-red-700 dark:focus:ring-red-800",
        "success" => "text-white bg-green-700 hover:bg-green-800 focus:ring-green-300 dark:bg-green-600 dark:hover:bg-green-700 dark:focus:ring-green-800",
        "light" => "text-gray-800 bg-gray-100 hover:bg-gray-200 focus:ring-gray-200 dark:text-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 dark:focus:ring-gray-600",
        _ => "text-white bg-gray-700 hover:bg-gray-800 focus:ring-gray-300 dark:bg-gray-600 dark:hover:bg-gray-700 dark:focus:ring-gray-800",
    };
}
