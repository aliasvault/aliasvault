//-----------------------------------------------------------------------
// <copyright file="TwoFactorAuthBase.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.E2ETests.Tests.Client.Shard3.Abstracts;

/// <summary>
/// Abstract base class for two factor auth test which contains common methods.
/// </summary>
public class TwoFactorAuthBase : ClientPlaywrightTest
{
    /// <summary>
    /// Helper method to disable two factor authentication in the client GUI if it is enabled.
    /// </summary>
    /// <returns>Task.</returns>
    protected async Task DisableTwoFactorIfEnabled()
    {
        // Ensure that two factor auth is not enabled (in case the test is run after the previous test).
        await NavigateUsingBlazorRouter("settings/security");
        await WaitForUrlAsync("settings/security", "Two factor authentication is currently");

        // Check if two factor auth is enabled.
        var enableButton = Page.Locator("button:has-text('Enable Two-Factor Authentication')");
        var isTwoFactorAuthEnabled = await enableButton.IsVisibleAsync();
        if (!isTwoFactorAuthEnabled)
        {
            // Disable two factor auth.
            var disableButton = Page.Locator("button:has-text('Disable Two-Factor Authentication')");
            await disableButton.ClickAsync();

            // Wait for the confirm disable button to be displayed.
            var confirmButton = Page.Locator("button:has-text('Confirm Disable Two-Factor Authentication')");
            await confirmButton.WaitForAsync(new LocatorWaitForOptions
            {
                State = WaitForSelectorState.Visible,
                Timeout = 5000,
            });

            // Press the confirm disable button as well.
            await confirmButton.ClickAsync();

            // Check if the success message is displayed
            var expectedMessage = "Two-factor authentication is now successfully disabled.";
            var successMessageLocator = Page.Locator($".messages-container div[role='alert']:has-text('{expectedMessage}')");
            await successMessageLocator.WaitForAsync(new LocatorWaitForOptions
            {
                State = WaitForSelectorState.Visible,
                Timeout = 5000,
            });

            var message = await successMessageLocator.TextContentAsync();
            Assert.That(message, Does.Contain("Two-factor authentication is now successfully disabled."), "No two-factor auth disable success message displayed.");
        }
    }

    /// <summary>
    /// Helper method to enable two factor authentication in the client GUI.
    /// </summary>
    /// <returns>A tuple containing the TOTP code and the first recovery code.</returns>
    protected async Task<(string TotpCode, string RecoveryCode)> EnableTwoFactor()
    {
         // Setup two-factor auth.
        await NavigateUsingBlazorRouter("settings/security");
        await WaitForUrlAsync("settings/security", "Two-factor Authentication");

        // Press the enable button with text "Enable Two-Factor Authentication"
        var enableButton = Page.Locator("button:has-text('Enable Two-Factor Authentication')");
        await enableButton.ClickAsync();

        // Wait for the secret to be displayed with ID "authenticator-secret"
        var secretElement = Page.Locator("div[id='authenticator-secret']");
        await secretElement.WaitForAsync(new LocatorWaitForOptions
        {
            State = WaitForSelectorState.Visible,
            Timeout = 5000,
        });

        var secret = await Page.TextContentAsync("div[id='authenticator-secret']");
        Assert.That(secret, Is.Not.Null.Or.Empty, "No secret displayed.");

        // Verify that a QR code image is displayed: #qrcode-authenticator-uri > img
        var qrCode = await Page.Locator("#qrcode-authenticator-uri img").GetAttributeAsync("src");
        Assert.That(qrCode, Does.Contain("data:image/png;base64"), "No QR code displayed.");

        // Generate a 2FA code using the secret.
        var totpCode = TotpGenerator.TotpGenerator.GenerateTotpCode(secret);
        Assert.That(totpCode, Is.Not.Null.Or.Empty, "No 2FA code generated.");

        // Fill in the 2FA code and submit the form.
        var totpField = Page.Locator("input[id='verificationCode']");
        await totpField.FillAsync(totpCode);

        var submitButton = Page.Locator("button:has-text('Verify and Enable')");
        await submitButton.ClickAsync();

        // Check if the recovery codes are displayed by id "recovery-codes"
        // wait for the recovery codes to be displayed.
        var recoveryCodesElement = Page.Locator("div[id='recovery-codes']");
        await recoveryCodesElement.WaitForAsync(new LocatorWaitForOptions
        {
            State = WaitForSelectorState.Visible,
            Timeout = 5000,
        });

        // Get the first recovery code.
        var recoveryCode = await Page.TextContentAsync("div[id='recovery-codes'] div:first-child");
        Assert.That(recoveryCode, Is.Not.Null.Or.Empty, "Recovery codes displayed but first value could not be extracted.");

        return (totpCode, recoveryCode!);
    }
}
