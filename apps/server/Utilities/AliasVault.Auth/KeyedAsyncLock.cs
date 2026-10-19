//-----------------------------------------------------------------------
// <copyright file="KeyedAsyncLock.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Auth;

using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;

/// <summary>
/// In-process async lock per key; it does not span API instances.
/// </summary>
public sealed class KeyedAsyncLock
{
    private readonly object gate = new();
    private readonly Dictionary<string, Entry> entries = new(StringComparer.Ordinal);

    /// <summary>
    /// Wait for the lock on a key. Dispose the result to release it.
    /// </summary>
    /// <param name="key">The key to lock.</param>
    /// <returns>The handle that releases the lock when disposed.</returns>
    public async Task<IDisposable> AcquireAsync(string key)
    {
        Entry entry;
        lock (gate)
        {
            if (!entries.TryGetValue(key, out var existing))
            {
                existing = new Entry();
                entries[key] = existing;
            }

            existing.Holders++;
            entry = existing;
        }

        await entry.Semaphore.WaitAsync();
        return new Releaser(this, key, entry);
    }

    private void Release(string key, Entry entry)
    {
        lock (gate)
        {
            entry.Holders--;
            if (entry.Holders == 0)
            {
                entries.Remove(key);
                entry.Semaphore.Dispose();
                return;
            }
        }

        entry.Semaphore.Release();
    }

    /// <summary>
    /// The lock of one key and how many callers hold or wait for it.
    /// </summary>
    private sealed class Entry
    {
        /// <summary>
        /// Gets the semaphore callers wait on.
        /// </summary>
        public SemaphoreSlim Semaphore { get; } = new(1, 1);

        /// <summary>
        /// Gets or sets the number of callers holding or waiting for the lock.
        /// </summary>
        public int Holders { get; set; }
    }

    /// <summary>
    /// Releases a held lock once, on dispose.
    /// </summary>
    private sealed class Releaser(KeyedAsyncLock owner, string key, Entry entry) : IDisposable
    {
        private int disposed;

        /// <inheritdoc />
        public void Dispose()
        {
            if (Interlocked.Exchange(ref disposed, 1) == 0)
            {
                owner.Release(key, entry);
            }
        }
    }
}
