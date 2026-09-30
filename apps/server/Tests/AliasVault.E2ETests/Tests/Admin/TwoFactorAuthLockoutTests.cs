//-----------------------------------------------------------------------
// <copyright file="TwoFactorAuthLockoutTests.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.E2ETests.Tests.Admin;

using OtpNet;

/// <summary>
/// End-to-end tests for two-factor auth lockout behavior.
/// </summary>
[Parallelizable(ParallelScope.Self)]
[Category("AdminTests")]
[TestFixture]
public class TwoFactorAuthLockoutTests : AdminPlaywrightTest
{
    /// <summary>
    /// Test if entering a wrong two-factor auth code too many times locks the account.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    public async Task AccountLockoutTest2Fa()
    {
        // Enable 2-factor authentication.
        await NavigateBrowser("account/manage/2fa");
        await WaitForUrlAsync("account/manage/2fa", "Authenticator app");

        var enable2FaButton = Page.GetByRole(AriaRole.Link, new() { Name = "Add authenticator app" });
        await enable2FaButton.ClickAsync();

        // Wait for QR code to appear.
        await WaitForUrlAsync("account/manage/enable-authenticator", "Scan the QR Code or enter this key");

        // Extract secret key from page.
        var secretKey = await Page.TextContentAsync("kbd");

        // Generate verification code.
        var totp = new Totp(Base32Encoding.ToBytes(secretKey!.Replace(" ", string.Empty))).ComputeTotp();

        // Fill in the form name="Input.Code".
        await Page.Locator("input[id='code']").FillAsync(totp);

        var submitButton = Page.GetByRole(AriaRole.Button, new() { Name = "Verify" });
        await submitButton.ClickAsync();

        // Wait for current page to refresh and confirm message shows.
        await WaitForUrlAsync("account/manage/enable-authenticator", "Put these codes in a safe place");

        // Logout.
        await Logout();

        // Try to login.
        var pageContent = await Page.TextContentAsync("body");
        Assert.That(pageContent, Does.Contain("Sign in to"), "No login page visible after logout.");

        // Login with username and password.
        // Enter login credentials.
        await InputHelper.FillInputFields(new Dictionary<string, string>
        {
            { "username", TestUserUsername },
            { "password", TestUserPassword },
        });

        submitButton = Page.GetByRole(AriaRole.Button, new() { Name = "Login" });
        await submitButton.ClickAsync();

        // Wait for 2FA page.
        await WaitForUrlAsync("user/loginWith2fa**", "Authenticator code");

        // Try to login with wrong 2FA code 10 times. After 10 times, the account should be locked.
        for (var i = 0; i < 10; i++)
        {
            await Page.Locator("input[id='two-factor-code']").FillAsync("000000");
            submitButton = Page.GetByRole(AriaRole.Button, new() { Name = "Log in" });
            await submitButton.ClickAsync();

            // Wait for the text "Error: Invalid login attempt." to appear if we expect not to be locked out yet..
            if (i == 9)
            {
                break;
            }

            await WaitForUrlAsync("user/loginWith2fa**", "Error: Invalid authenticator code.");
        }

        // Wait for account lockout message.
        await WaitForUrlAsync("user/lockout**", "Locked out");
        pageContent = await Page.TextContentAsync("body");
        Assert.That(pageContent, Does.Contain("You have entered an incorrect password too many times"), "No account lockout message shown after 10 failed login attempts.");
    }
}
