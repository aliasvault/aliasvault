//-----------------------------------------------------------------------
// <copyright file="StatusHostedServiceTests.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.IntegrationTests.StatusHostedService;

using AliasVault.IntegrationTests.StatusHostedService.Helpers;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Hosting;

/// <summary>
/// Integration tests for StatusHostedService wrapper.
/// </summary>
[TestFixture]
public class StatusHostedServiceTests
{
    /// <summary>
    /// The test host instance.
    /// </summary>
    private IHost _testHost;

    /// <summary>
    /// The test host builder instance.
    /// </summary>
    private TestHostBuilder _testHostBuilder;

    /// <summary>
    /// Setup logic for every test.
    /// </summary>
    [SetUp]
    public void Setup()
    {
        _testHostBuilder = new TestHostBuilder();
        _testHost = _testHostBuilder.Build();
    }

    /// <summary>
    /// Tear down logic for every test.
    /// </summary>
    /// <returns>Task.</returns>
    [TearDown]
    public async Task TearDown()
    {
        await _testHost.StopAsync();
        _testHost.Dispose();
        await _testHostBuilder.DisposeAsync();
    }

    /// <summary>
    /// Tests that the StatusHostedService properly logs errors from the wrapped service.
    /// </summary>
    /// <returns>Task.</returns>
    [Test]
    public async Task LogsExceptionFromWrappedService()
    {
        // Start the service which will trigger the TestExceptionWorker to throw an exception.
        await _testHost.StartAsync();

        // Give it a moment to process.
        await Task.Delay(3000);

        // Check the logs for the expected error.
        await using var dbContext = _testHostBuilder.GetDbContext();
        var errorLog = await dbContext.Logs
            .OrderByDescending(l => l.TimeStamp)
            .FirstOrDefaultAsync(l => l.Level == "Error" && l.Exception.Contains("Test exception"));

        Assert.That(errorLog, Is.Not.Null, "Expected error log from TestExceptionWorker was not found");
        Assert.That(errorLog.Message, Does.Contain("An error occurred in StatusHostedService"), "Error log does not contain expected message from StatusHostedService");
    }
}
