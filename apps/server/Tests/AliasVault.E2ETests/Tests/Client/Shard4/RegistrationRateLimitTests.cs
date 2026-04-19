//-----------------------------------------------------------------------
// <copyright file="RegistrationRateLimitTests.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.E2ETests.Tests.Client.Shard4;

using AliasVault.Auth;
using AliasVault.Shared.Models.Enums;
using Microsoft.EntityFrameworkCore;

/// <summary>
/// End-to-end tests for registration rate limiting.
/// </summary>
[Parallelizable(ParallelScope.Self)]
[Category("ClientTests")]
[TestFixture]
public class RegistrationRateLimitTests : ClientPlaywrightTest
{
    /// <summary>
    /// Test that registration rate limiting works correctly.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    public async Task RegistrationRateLimitingTest()
    {
        // Set the registration rate limit to 2 accounts per IP per 24 hours
        // Note: The test user account was already created during test setup, so that's 1/2 accounts used
        await ApiServerSettings.SetSettingAsync("MaxRegistrationsPerIpPer24Hours", "2");

        // Logout the current test user
        await Logout();

        // Register the second account (first one was created during test setup)
        var user1 = "ratelimit1@example.com";
        await Register(checkForSuccess: true, username: user1);
        await Logout();

        // Attempt to register third account - should be blocked by rate limit
        // since we've now hit the limit of 2 registrations (test user + user1)
        var user2 = "ratelimit2@example.com";

        // Navigate to registration page
        await Page.GotoAsync(AppBaseUrl);
        await WaitForUrlAsync("user/start", "Log in with");
        await NavigateUsingBlazorRouter("user/register");
        await WaitForUrlAsync("user/register", "Create account");

        var emailField = await WaitForAndGetElement("input[id='email']");
        var passwordField = await WaitForAndGetElement("input[id='password']");
        var password2Field = await WaitForAndGetElement("input[id='password2']");

        await emailField.FillAsync(user2);
        await passwordField.FillAsync(TestUserPassword);
        await password2Field.FillAsync(TestUserPassword);

        // Click somewhere to hide auto-popup and check terms checkbox
        await Page.ClickAsync("body");
        var termsCheckbox = await WaitForAndGetElement("input[id='terms']");
        await termsCheckbox.CheckAsync();

        var submitButton = await WaitForAndGetElement("button[type='submit']");
        await submitButton.ClickAsync();

        // Wait for rate limit error message
        await Task.Delay(1000);

        // Check that registration was blocked (should still be on registration page with error)
        Assert.That(Page.Url, Does.Contain("user/register"), "Should still be on registration page after rate limit exceeded.");

        // Verify that the auth log contains a failed registration with the rate limit exceeded reason
        var failedRegistration = await ApiDbContext.AuthLogs.FirstOrDefaultAsync(x =>
            x.Username == user2 &&
            x.EventType == AuthEventType.Register &&
            !x.IsSuccess &&
            x.FailureReason == AliasServerDb.AuthFailureReason.RegistrationRateLimitExceeded);

        Assert.That(failedRegistration, Is.Not.Null, "Failed registration auth log entry with rate limit exceeded reason not found.");

        // Verify only 2 successful registrations were recorded (test user + user1)
        var successfulRegistrations = await ApiDbContext.AuthLogs.CountAsync(x =>
            (x.Username == TestUserUsername || x.Username == user1 || x.Username == user2) &&
            x.EventType == AuthEventType.Register &&
            x.IsSuccess);

        Assert.That(successfulRegistrations, Is.EqualTo(2), "Expected exactly 2 successful registrations (test user + user1).");
    }
}
