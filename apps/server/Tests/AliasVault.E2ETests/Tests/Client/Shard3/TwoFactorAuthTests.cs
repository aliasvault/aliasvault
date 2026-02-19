//-----------------------------------------------------------------------
// <copyright file="TwoFactorAuthTests.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.E2ETests.Tests.Client.Shard3;

using AliasVault.E2ETests.Tests.Client.Shard3.Abstracts;

/// <summary>
/// End-to-end tests for user two-factor authentication.
/// </summary>
[Parallelizable(ParallelScope.Self)]
[Category("ClientTests")]
[TestFixture]
public class TwoFactorAuthTests : TwoFactorAuthBase
{
    /// <summary>
    /// Test if setting up two-factor authentication and then logging in works.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    public async Task Setup2FactorAuthAndLogin()
    {
        await DisableTwoFactorIfEnabled();
        var (totpCode, _) = await EnableTwoFactor();

        // Check if the success message is displayed (target the app notification area, not the error UI in index.html).
        var successMessage = Page.Locator(".messages-container div[role='alert']");
        await successMessage.WaitForAsync(new LocatorWaitForOptions
        {
            State = WaitForSelectorState.Visible,
            Timeout = 5000,
        });
        var message = await successMessage.TextContentAsync();
        Assert.That(message, Does.Contain("Two-factor authentication is now successfully enabled."), "No success message displayed.");

        await Logout();
        await NavigateToLogin();

        // Wait for the page to fully load.
        await Task.Delay(100);

        var emailField = await WaitForAndGetElement("input[id='email']");
        var passwordField = await WaitForAndGetElement("input[id='password']");

        await emailField.FillAsync(TestUserUsername);
        await passwordField.FillAsync(TestUserPassword);

        var loginButton = await WaitForAndGetElement("button[type='submit']");
        await loginButton.ClickAsync();

        // Check if we get a 2FA code prompt by checking for text "Authenticator code".
        var prompt = await Page.TextContentAsync("label:has-text('Authenticator code')");
        Assert.That(prompt, Does.Contain("Authenticator code"), "No 2FA code prompt displayed.");

        // Fill in the 2FA code.
        var totpField = await WaitForAndGetElement("input[id='two-factor-code']");
        await totpField.FillAsync(totpCode);

        // Form should auto-submit after filling in the 6-digit code.

        // Check if we get redirected to the index page.
        await WaitForUrlAsync("welcome**", WelcomeMessage);
    }

    /// <summary>
    /// Test if setting up two-factor authentication and then using a recovery code to login works.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    public async Task Setup2FactorAuthAndLoginWithRecoveryCode()
    {
        await DisableTwoFactorIfEnabled();
        var (_, recoveryCode) = await EnableTwoFactor();

        await Logout();
        await NavigateToLogin();

        // Wait for the page to fully load.
        await Task.Delay(100);

        var emailField = await WaitForAndGetElement("input[id='email']");
        var passwordField = await WaitForAndGetElement("input[id='password']");
        await emailField.FillAsync(TestUserUsername);
        await passwordField.FillAsync(TestUserPassword);

        var loginButton = await WaitForAndGetElement("button[type='submit']");
        await loginButton.ClickAsync();

        // Check if we get a 2FA code prompt by checking for text "Authenticator code".
        var prompt = await Page.TextContentAsync("label:has-text('Authenticator code')");
        Assert.That(prompt, Does.Contain("Authenticator code"), "No 2FA code prompt displayed.");

        // Click the "log in with a recovery code" button.
        var useRecoveryCodeButton = Page.Locator("button:has-text('log in with a recovery code')");
        await useRecoveryCodeButton.ClickAsync();

        // Fill in the recovery code and submit the form.
        var recoveryCodeField = Page.Locator("input[id='recovery-code']");
        await recoveryCodeField.FillAsync(recoveryCode);

        var submitButton = Page.Locator("button[type='submit']");
        await submitButton.ClickAsync();

        // Check if we get redirected to the index page.
        await WaitForUrlAsync("welcome**", WelcomeMessage);
    }
}
