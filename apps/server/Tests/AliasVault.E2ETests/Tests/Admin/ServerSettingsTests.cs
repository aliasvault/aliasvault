//-----------------------------------------------------------------------
// <copyright file="ServerSettingsTests.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.E2ETests.Tests.Admin;

using Microsoft.EntityFrameworkCore;

/// <summary>
/// End-to-end tests for server settings feature.
/// </summary>
[Parallelizable(ParallelScope.Self)]
[Category("AdminTests")]
[TestFixture]
public class ServerSettingsTests : AdminPlaywrightTest
{
    /// <summary>
    /// Test if mutating server settings works correctly.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    public async Task ServerSettingsMutationTest()
    {
        // Navigate to server settings page
        await NavigateBrowser("settings/server");
        await WaitForUrlAsync("settings/server", "Server settings");

        // Set new values for retention settings
        await Page.Locator("input[id='generalLogRetention']").FillAsync("45");
        await Page.Locator("input[id='authLogRetention']").FillAsync("120");
        await Page.Locator("input[id='emailRetention']").FillAsync("60");
        await Page.Locator("input[id='maxEmails']").FillAsync("200");
        await Page.Locator("input[id='markInactiveDays']").FillAsync("180");
        await Page.Locator("input[id='maxEmailsInactive']").FillAsync("50");

        // Set maintenance time
        await Page.Locator("input[id='schedule']").FillAsync("03:30");

        // Uncheck Sunday and Saturday from maintenance days
        await Page.Locator("input[id='day_6']").UncheckAsync(); // Saturday
        await Page.Locator("input[id='day_7']").UncheckAsync(); // Sunday

        // Save changes
        var saveButton = Page.Locator("text=Save changes");
        await saveButton.ClickAsync();

        // Wait for success message
        await WaitForUrlAsync("settings/server", "Settings saved successfully");

        // Verify settings in database
        var settings = await DbContext.ServerSettings.ToListAsync();

        // Check retention settings
        var generalLogRetention = settings.Find(s => s.Key == "GeneralLogRetentionDays");
        Assert.That(generalLogRetention?.Value, Is.EqualTo("45"), "General log retention days not saved correctly");

        var authLogRetention = settings.Find(s => s.Key == "AuthLogRetentionDays");
        Assert.That(authLogRetention?.Value, Is.EqualTo("120"), "Auth log retention days not saved correctly");

        var emailRetention = settings.Find(s => s.Key == "EmailRetentionDays");
        Assert.That(emailRetention?.Value, Is.EqualTo("60"), "Email retention days not saved correctly");

        var maxEmails = settings.Find(s => s.Key == "MaxEmailsPerUser");
        Assert.That(maxEmails?.Value, Is.EqualTo("200"), "Max emails per user not saved correctly");

        var markInactiveDays = settings.Find(s => s.Key == "MarkUserInactiveAfterDays");
        Assert.That(markInactiveDays?.Value, Is.EqualTo("180"), "Mark user inactive after days not saved correctly");

        var maxEmailsInactive = settings.Find(s => s.Key == "MaxEmailsPerInactiveUser");
        Assert.That(maxEmailsInactive?.Value, Is.EqualTo("50"), "Max emails per inactive user not saved correctly");

        // Check maintenance schedule
        var maintenanceTime = settings.Find(s => s.Key == "MaintenanceTime");
        Assert.That(maintenanceTime?.Value, Is.EqualTo("03:30"), "Maintenance time not saved correctly");

        var taskRunnerDays = settings.Find(s => s.Key == "TaskRunnerDays");
        Assert.That(taskRunnerDays?.Value, Is.EqualTo("1,2,3,4,5"), "Task runner days not saved correctly");

        // Refresh page and verify values persist
        await Page.ReloadAsync();
        await WaitForUrlAsync("settings/server", "Server settings");

        // Wait for 0.5sec to ensure the page is fully loaded.
        await Task.Delay(500);

        var generalLogRetentionValue = await Page.Locator("input[id='generalLogRetention']").InputValueAsync();
        Assert.That(generalLogRetentionValue, Is.EqualTo("45"), "General log retention value not persisted after refresh");

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
