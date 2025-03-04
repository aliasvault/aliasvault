//-----------------------------------------------------------------------
// <copyright file="WelcomeScreenTests.cs" company="lanedirt">
// Copyright (c) lanedirt. All rights reserved.
// Licensed under the MIT license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.E2ETests.Tests.Client.Shard4;

/// <summary>
/// End-to-end tests for the welcome screen (tutorial) steps.
/// </summary>
[Parallelizable(ParallelScope.Self)]
[Category("ClientTests")]
[TestFixture]
public class WelcomeScreenTests : ClientPlaywrightTest
{
    /// <summary>
    /// Test if the welcome screen can be completed and the tutorial is no longer shown after that.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    [Order(1)]
    public async Task WelcomeScreenTest()
    {
        // Click the "Continue" button
        var continueButton = await WaitForAndGetElement("button:has-text('Continue')");
        await continueButton.ClickAsync();

        // Wait for the "How AliasVault works" step to load.
        await WaitForUrlAsync("welcome", "How AliasVault works");

        // Click the "Continue" button.
        continueButton = await WaitForAndGetElement("button:has-text('Continue')");
        await continueButton.ClickAsync();

        // Wait for the "Tips" step to load.
        await WaitForUrlAsync("welcome", "Tips");

        // Click on the "Get started" button.
        var getStartedButton = await WaitForAndGetElement("button:has-text('Get started')");
        await getStartedButton.ClickAsync();

        // Wait for the credentials page to load with the placeholder text.
        await WaitForUrlAsync("credentials", "No credentials yet");

        // Verify that after hard reloading the page, the credentials page is still loaded with the placeholder text
        // and the tutorial is no longer shown.
        await RefreshPageAndUnlockVault();
        await WaitForUrlAsync("credentials", "No credentials yet");

        // Verify that the welcome screen is no longer shown.
        var pageContent = await Page.TextContentAsync("body");
        Assert.That(pageContent, Does.Not.Contain(WelcomeMessage));
    }
}
