//-----------------------------------------------------------------------
// <copyright file="StatusWorkerResilienceTests.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.IntegrationTests.StatusHostedService;

using System.Reflection;
using AliasVault.IntegrationTests.StatusHostedService.Helpers;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Hosting;

/// <summary>
/// Regression tests ensuring the StatusWorker recovers itself when a exception is thrown
/// inside the worker logic.
/// </summary>
[TestFixture]
public class StatusWorkerResilienceTests
{
    /// <summary>
    /// The test host instance.
    /// </summary>
    private IHost _testHost = null!;

    /// <summary>
    /// The test host builder instance.
    /// </summary>
    private StatusWorkerResilienceTestHostBuilder _testHostBuilder = null!;

    /// <summary>
    /// Setup logic for every test.
    /// </summary>
    [SetUp]
    public void Setup()
    {
        _testHostBuilder = new StatusWorkerResilienceTestHostBuilder();
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
    /// Verifies that the StatusWorker recovers itself when a exception is thrown inside the worker logic.
    /// </summary>
    /// <returns>Task.</returns>
    [Test]
    public async Task ExceptionThrownInsideWorkerLogicDoesNotSoftStopService()
    {
        await _testHost.StartAsync();

        var serviceName = Assembly.GetExecutingAssembly().GetName().Name!;
        string? currentStatus = null;
        var deadline = DateTime.UtcNow.AddSeconds(40);

        while (DateTime.UtcNow < deadline)
        {
            await using var dbContext = await _testHostBuilder.GetDbContextAsync();
            var entry = await dbContext.WorkerServiceStatuses.AsNoTracking().FirstOrDefaultAsync(x => x.ServiceName == serviceName);
            currentStatus = entry?.CurrentStatus;

            if (currentStatus == "Started")
            {
                break;
            }

            await Task.Delay(1000);
        }

        Assert.That(currentStatus, Is.EqualTo("Started"), "Service should recover to Started after a exception is thrown inside the worker logic instead of remaining soft-stopped.");
    }
}
