//-----------------------------------------------------------------------
// <copyright file="WebApplicationClientFactoryFixture.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.E2ETests.Infrastructure;

using Microsoft.AspNetCore.Mvc.Testing;

/// <summary>
/// Client web application factory fixture for integration tests.
/// </summary>
/// <typeparam name="TEntryPoint">The entry point.</typeparam>
public class WebApplicationClientFactoryFixture<TEntryPoint> : WebApplicationFactory<TEntryPoint>
    where TEntryPoint : class
{
    /// <summary>
    /// Whether UseKestrel has been called.
    /// </summary>
    private bool _kestrelConfigured;

    /// <summary>
    /// Gets or sets the port the web application kestrel host will listen on.
    /// </summary>
    public int Port { get; set; } = 5002;

    /// <summary>
    /// Initializes the factory with Kestrel on the specified port.
    /// Must be called before CreateDefaultClient() in tests.
    /// </summary>
    public void InitializeKestrel()
    {
        if (!_kestrelConfigured)
        {
            UseKestrel(Port);
            _kestrelConfigured = true;
        }
    }
}
