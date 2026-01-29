//-----------------------------------------------------------------------
// <copyright file="PasswordLockoutTests.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.E2ETests.Tests.Admin;

/// <summary>
/// End-to-end tests for password lockout behavior.
/// </summary>
[Parallelizable(ParallelScope.Self)]
[Category("AdminTests")]
[TestFixture]
public class PasswordLockoutTests : AdminPlaywrightTest
{
    /// <summary>
    /// Test if entering a wrong password too many times locks the account.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    public async Task AccountLockoutTestPassword()
    {
        await Logout();

        var pageContent = await Page.TextContentAsync("body");
        Assert.That(pageContent, Does.Contain("Login to your"), "No login page visible after logout.");

        // Try to login with wrong password 10 times. After 10 times, the account should be locked.
        for (var i = 0; i < 10; i++)
        {
            await Page.Locator("input[id='username']").FillAsync(TestUserUsername);
            await Page.Locator("input[id='password']").FillAsync("wrongpassword");
            var submitButton = Page.GetByRole(AriaRole.Button, new() { Name = "Login" });
            await submitButton.ClickAsync();

            // Wait for the text "Error: Invalid login attempt." to appear if we expect not to be locked out yet..
            if (i == 9)
            {
                break;
            }

            await WaitForUrlAsync("user/login**", "Error: Invalid login attempt.");
        }

        // Wait for account lockout message.
        await WaitForUrlAsync("user/lockout**", "Locked out");
        pageContent = await Page.TextContentAsync("body");
        Assert.That(pageContent, Does.Contain("You have entered an incorrect password too many times"), "No account lockout message shown after 10 failed login attempts.");
    }
}
