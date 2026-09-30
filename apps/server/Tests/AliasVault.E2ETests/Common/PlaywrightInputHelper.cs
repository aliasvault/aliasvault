//-----------------------------------------------------------------------
// <copyright file="PlaywrightInputHelper.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.E2ETests.Common;

/// <summary>
/// Playwright input helper class.
/// </summary>
/// <param name="page">The IPage instance for the current test.</param>
public class PlaywrightInputHelper(IPage page)
{
    /// <summary>
    /// Helper method to fill specified input fields on a page with given values.
    /// </summary>
    /// <param name="fieldValues">Dictionary with html element ids and values to input as field value.</param>
    /// <returns>Async task.</returns>
    public async Task FillInputFields(Dictionary<string, string>? fieldValues = null)
    {
        var inputFields = page.Locator("input, textarea");
        var count = await inputFields.CountAsync();
        for (int i = 0; i < count; i++)
        {
            var input = inputFields.Nth(i);
            var inputId = await input.GetAttributeAsync("id");

            // If fieldValues dictionary is provided and the inputId is found in it, fill the input with the value.
            if (inputId is not null && fieldValues is not null && fieldValues.TryGetValue(inputId, out var fieldValue))
            {
                await input.FillAsync(fieldValue);
            }
        }
    }
}
