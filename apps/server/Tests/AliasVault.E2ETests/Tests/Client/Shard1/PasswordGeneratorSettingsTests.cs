//-----------------------------------------------------------------------
// <copyright file="PasswordGeneratorSettingsTests.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.E2ETests.Tests.Client.Shard1;

/// <summary>
/// End-to-end tests for the password generator UI (inline slider on the item edit form and the
/// advanced settings popup).
/// </summary>
[TestFixture]
[Category("ClientTests")]
[Parallelizable(ParallelScope.Self)]
public class PasswordGeneratorSettingsTests : ClientPlaywrightTest
{
    /// <summary>
    /// Tests that the inline generator slider appears directly below the password field on the item
    /// edit form, showing the character-length slider for the basic generator and the word-count slider
    /// after switching to the Diceware (passphrase) generator. This mirrors the browser extension and
    /// mobile app, where the slider is available inline without opening the settings popup.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    public async Task InlineLengthSliderVisibleForBothGeneratorTypes()
    {
        await NavigateUsingBlazorRouter("items/create");
        await WaitForUrlAsync("items/create", "Add Item");

        // The basic generator is the default: the inline slider must be the character-length slider (0-100).
        var inlineSlider = Page.Locator("#password-inline-length");
        await inlineSlider.WaitForAsync(new() { State = WaitForSelectorState.Visible, Timeout = TestDefaults.DefaultTimeout });
        Assert.That(await inlineSlider.IsVisibleAsync(), Is.True, "Inline password length slider not visible below the password field.");
        Assert.That(await inlineSlider.GetAttributeAsync("min"), Is.EqualTo("0"), "Inline slider is not the character-length slider in basic mode.");

        // Open the generator settings popup and switch to the Passphrase (Diceware) generator for this field only.
        await Page.Locator("#password-generator-settings").ClickAsync();
        await Page.WaitForSelectorAsync("#passwordSettingsModal", new() { State = WaitForSelectorState.Visible, Timeout = TestDefaults.DefaultTimeout });
        await Page.Locator("#passwordSettingsModal button:text-is('Passphrase')").ClickAsync();
        await Page.Locator("#passwordSettingsModal button:has-text('Use Just Once')").ClickAsync();

        // The inline slider must now be the Diceware word-count slider (3-10).
        await inlineSlider.WaitForAsync(new() { State = WaitForSelectorState.Visible, Timeout = TestDefaults.DefaultTimeout });
        Assert.That(await inlineSlider.IsVisibleAsync(), Is.True, "Inline slider not visible after switching to passphrase generator.");
        Assert.That(await inlineSlider.GetAttributeAsync("min"), Is.EqualTo("3"), "Inline slider is not the word-count slider in passphrase mode.");
    }

    /// <summary>
    /// Tests that the advanced settings popup shows the correct length slider for each generator type:
    /// the character-length slider in "Password" (basic) mode and the word-count slider in "Passphrase"
    /// (Diceware) mode.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    public async Task PopupLengthSliderVisibleForBothGeneratorTypes()
    {
        await NavigateUsingBlazorRouter("settings/general");
        await WaitForUrlAsync("settings/general", "Configure general");

        // Open the password generator settings popup.
        await Page.Locator("#password-generator-settings-modal").ClickAsync();
        await Page.WaitForSelectorAsync("#passwordSettingsModal", new() { State = WaitForSelectorState.Visible, Timeout = TestDefaults.DefaultTimeout });

        // The "Password" (basic) generator is selected by default: the character-length slider must be visible.
        var lengthSlider = Page.Locator("#password-length");
        await lengthSlider.WaitForAsync(new() { State = WaitForSelectorState.Visible, Timeout = TestDefaults.DefaultTimeout });
        Assert.That(await lengthSlider.IsVisibleAsync(), Is.True, "Password length slider not visible in basic password mode.");

        // Switch to the "Passphrase" (Diceware) tab.
        await Page.Locator("#passwordSettingsModal button:text-is('Passphrase')").ClickAsync();

        // In Diceware mode the word-count slider must be visible and the basic length slider must be gone.
        var wordCountSlider = Page.Locator("#diceware-word-count");
        await wordCountSlider.WaitForAsync(new() { State = WaitForSelectorState.Visible, Timeout = TestDefaults.DefaultTimeout });
        Assert.That(await wordCountSlider.IsVisibleAsync(), Is.True, "Diceware word count slider not visible in passphrase mode.");
        Assert.That(await lengthSlider.CountAsync(), Is.EqualTo(0), "Password length slider should be hidden in passphrase mode.");

        // Switch back to the "Password" (basic) tab: the character-length slider must reappear.
        await Page.Locator("#passwordSettingsModal button:text-is('Password')").ClickAsync();
        await lengthSlider.WaitForAsync(new() { State = WaitForSelectorState.Visible, Timeout = TestDefaults.DefaultTimeout });
        Assert.That(await lengthSlider.IsVisibleAsync(), Is.True, "Password length slider not visible after switching back to basic mode.");
    }
}
