//-----------------------------------------------------------------------
// <copyright file="SmtpServerWorker.cs" company="lanedirt">
// Copyright (c) lanedirt. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.SmtpService.Workers;

/// <summary>
/// A worker for the SMTP server.
/// </summary>
/// <param name="logger">ILogger instance.</param>
/// <param name="smtpServer">SmtpServer instance.</param>
public class SmtpServerWorker(ILogger<SmtpServerWorker> logger, SmtpServer.SmtpServer smtpServer) : BackgroundService
{
    /// <inheritdoc />
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        logger.LogWarning("AliasVault.SmtpService started at: {Time}", DateTimeOffset.Now);

        // Start the SMTP server
        await smtpServer.StartAsync(stoppingToken);
    }
}
