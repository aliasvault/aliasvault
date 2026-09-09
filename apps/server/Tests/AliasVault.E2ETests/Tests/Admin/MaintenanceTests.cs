//-----------------------------------------------------------------------
// <copyright file="MaintenanceTests.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.E2ETests.Tests.Admin;

using Microsoft.EntityFrameworkCore;

/// <summary>
/// End-to-end tests for the maintenance page.
/// </summary>
[Parallelizable(ParallelScope.Self)]
[Category("AdminTests")]
[TestFixture]
public class MaintenanceTests : AdminPlaywrightTest
{
    /// <summary>
    /// Test if mutating the maintenance schedule works correctly.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    public async Task MaintenanceScheduleMutationTest()
    {
        // Navigate to maintenance page
        await NavigateBrowser("maintenance");
        await WaitForUrlAsync("maintenance", "Maintenance Schedule");

        // Set maintenance time
        await Page.Locator("input[id='schedule']").FillAsync("03:30");

        // Uncheck Sunday and Saturday from maintenance days
        await Page.Locator("input[id='day_6']").UncheckAsync(); // Saturday
        await Page.Locator("input[id='day_7']").UncheckAsync(); // Sunday

        // Save changes
        var saveButton = Page.Locator("text=Save changes");
        await saveButton.ClickAsync();

        // Wait for success message
        await WaitForUrlAsync("maintenance", "Settings saved successfully");

        // Verify settings in database
        var settings = await DbContext.ServerSettings.ToListAsync();

        var maintenanceTime = settings.Find(s => s.Key == "MaintenanceTime");
        Assert.That(maintenanceTime?.Value, Is.EqualTo("03:30"), "Maintenance time not saved correctly");

        var taskRunnerDays = settings.Find(s => s.Key == "TaskRunnerDays");
        Assert.That(taskRunnerDays?.Value, Is.EqualTo("1,2,3,4,5"), "Task runner days not saved correctly");

        // Refresh page and verify values persist
        await Page.ReloadAsync();
        await WaitForUrlAsync("maintenance", "Maintenance Schedule");

        // Wait for 0.5sec to ensure the page is fully loaded.
        await Task.Delay(500);

        var maintenanceTimeValue = await Page.Locator("input[id='schedule']").InputValueAsync();
        Assert.That(maintenanceTimeValue, Does.Contain("03:30"), "Maintenance time value not persisted after refresh");

        // Verify weekend days are still unchecked
        var sundayChecked = await Page.Locator("input[id='day_7']").IsCheckedAsync();
        var saturdayChecked = await Page.Locator("input[id='day_6']").IsCheckedAsync();
        Assert.Multiple(() =>
        {
            Assert.That(sundayChecked, Is.False, "Sunday checkbox should be unchecked");
            Assert.That(saturdayChecked, Is.False, "Saturday checkbox should be unchecked");
        });
    }
}
