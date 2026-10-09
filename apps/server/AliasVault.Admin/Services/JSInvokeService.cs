//-----------------------------------------------------------------------
// <copyright file="JSInvokeService.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Admin.Services;

using Microsoft.JSInterop;

/// <summary>
/// Service for invoking JavaScript functions from C#.
/// </summary>
public class JsInvokeService(IJSRuntime js)
{
    /// <summary>
    /// The smallest delay between attempts, so a zero initial delay still backs off.
    /// </summary>
    private static readonly TimeSpan MinRetryDelay = TimeSpan.FromMilliseconds(50);

    /// <summary>
    /// Invoke a JavaScript function with retry and exponential backoff.
    /// </summary>
    /// <param name="functionName">The JS function name to call.</param>
    /// <param name="initialDelay">Initial delay before calling the function.</param>
    /// <param name="maxAttempts">Maximum attempts before giving up.</param>
    /// <param name="args">Arguments to pass on to the javascript function.</param>
    /// <returns>Async Task.</returns>
    public async Task RetryInvokeAsync(string functionName, TimeSpan initialDelay, int maxAttempts, params object[] args)
    {
        TimeSpan delay = initialDelay > MinRetryDelay ? initialDelay : MinRetryDelay;
        for (int attempt = 1; attempt <= maxAttempts; attempt++)
        {
            try
            {
                bool isDefined = await js.InvokeAsync<bool>("isFunctionDefined", functionName);
                if (isDefined)
                {
                    await js.InvokeVoidAsync(functionName, args);
                    return; // Successfully called the JS function, exit the method
                }
            }
            catch (JSDisconnectedException)
            {
                // The browser is gone, retrying cannot succeed.
                return;
            }
            catch
            {
                // Optionally log the exception
            }

            // Wait for the delay before the next attempt
            await Task.Delay(delay);

            // Exponential backoff: double the delay for the next attempt
            delay = TimeSpan.FromTicks(delay.Ticks * 2);
        }

        // Optionally log that the JS function could not be called after maxAttempts
    }

    /// <summary>
    /// Invoke a JavaScript function with retry and exponential backoff that returns a value.
    /// </summary>
    /// <typeparam name="TValue">The type of value to return from the JavaScript function.</typeparam>
    /// <param name="functionName">The JS function name to call.</param>
    /// <param name="initialDelay">Initial delay before calling the function.</param>
    /// <param name="maxAttempts">Maximum attempts before giving up.</param>
    /// <param name="args">Arguments to pass on to the javascript function.</param>
    /// <returns>The value returned from the JavaScript function.</returns>
    /// <exception cref="InvalidOperationException">Thrown when the JS function could not be called after all attempts.</exception>
    /// <exception cref="JSDisconnectedException">Thrown when the browser disconnected from the circuit.</exception>
    public async Task<TValue> RetryInvokeWithResultAsync<TValue>(string functionName, TimeSpan initialDelay, int maxAttempts, params object[] args)
    {
        TimeSpan delay = initialDelay > MinRetryDelay ? initialDelay : MinRetryDelay;

        for (int attempt = 1; attempt <= maxAttempts; attempt++)
        {
            try
            {
                bool isDefined = await js.InvokeAsync<bool>("isFunctionDefined", functionName);
                if (isDefined)
                {
                    return await js.InvokeAsync<TValue>(functionName, args);
                }
            }
            catch (JSDisconnectedException)
            {
                // The browser is gone, retrying cannot succeed.
                throw;
            }
            catch
            {
                // Optionally log the exception
            }

            // Wait for the delay before the next attempt
            await Task.Delay(delay);

            // Exponential backoff: double the delay for the next attempt
            delay = TimeSpan.FromTicks(delay.Ticks * 2);
        }

        // All attempts failed, throw an exception
        throw new InvalidOperationException($"Failed to invoke JavaScript function '{functionName}' after {maxAttempts} attempts.");
    }
}
