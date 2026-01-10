//-----------------------------------------------------------------------
// <copyright file="DbServiceState.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Services.Database;

/// <summary>
/// Class to manage the state of the DbService that others can subscribe to events for.
/// </summary>
public sealed class DbServiceState
{
    private DatabaseState _currentState = new();

    /// <summary>
    /// Subscribe to this event to get notified when the state of the database changes.
    /// </summary>
    public event EventHandler<DatabaseState> StateChanged = (sender, e) => { };

    /// <summary>
    /// Database status enum.
    /// </summary>
    public enum DatabaseStatus
    {
        /// <summary>
        /// Database not initialized (yet).
        /// </summary>
        Uninitialized,

        /// <summary>
        /// Database is loading from server.
        /// </summary>
        Loading,

        /// <summary>
        /// Database is being created.
        /// </summary>
        Creating,

        /// <summary>
        /// Database failed to decrypt. No data is accessible.
        /// </summary>
        DecryptionFailed,

        /// <summary>
        /// The loaded vault version is not recognized by the current client (most likely a new version).
        /// </summary>
        VaultVersionUnrecognized,

        /// <summary>
        /// Database has been decrypted but has pending migrations and needs to be updated.
        /// </summary>
        PendingMigrations,

        /// <summary>
        /// Database is ready but no task is currently in progress.
        /// </summary>
        Ready,

        /// <summary>
        /// Database is saving to server.
        /// </summary>
        SavingToServer,

        /// <summary>
        /// Database has local changes pending background sync to server.
        /// Used for non-blocking mutations where UI doesn't wait for server sync.
        /// </summary>
        BackgroundSyncPending,
    }

    /// <summary>
    /// Gets the current state of the database.
    /// </summary>
    public DatabaseState CurrentState
    {
        get => _currentState;
        private set
        {
            if (_currentState != value)
            {
                _currentState = value;
                OnStateChanged(_currentState);
            }
        }
    }

    /// <summary>
    /// Update the state of the database.
    /// </summary>
    /// <param name="status">New status.</param>
    public void UpdateState(DatabaseStatus status)
    {
        CurrentState = new DatabaseState
        {
            Status = status,
            Message = string.Empty,
            LastUpdated = DateTime.Now,
        };
    }

    /// <summary>
    /// Update the state of the database with an additional message.
    /// </summary>
    /// <param name="status">New status.</param>
    /// <param name="message">Status message.</param>
    public void UpdateState(DatabaseStatus status, string message)
    {
        CurrentState = new DatabaseState
        {
            Status = status,
            Message = message,
            LastUpdated = DateTime.Now,
        };
    }

    /// <summary>
    /// OnStateChanged event handler.
    /// </summary>
    /// <param name="newState">The new state.</param>
    private void OnStateChanged(DatabaseState newState)
    {
        StateChanged?.Invoke(this, newState);
    }

    /// <summary>
    /// Database state class.
    /// </summary>
    public class DatabaseState
    {
        /// <summary>
        /// Gets or sets the current status of the database.
        /// </summary>
        public DatabaseStatus Status { get; set; } = DatabaseStatus.Uninitialized;

        /// <summary>
        /// Gets or sets the message associated with the current status.
        /// </summary>
        public string Message { get; set; } = string.Empty;

        /// <summary>
        /// Gets or sets the last time the state was updated.
        /// </summary>
        public DateTime LastUpdated { get; set; } = DateTime.Now;

        /// <summary>
        /// Returns true if the database state represents an initialized state.
        /// </summary>
        /// <returns>Bool.</returns>
        public bool IsInitialized()
        {
            return Status is DatabaseStatus.Ready or DatabaseStatus.SavingToServer or DatabaseStatus.BackgroundSyncPending;
        }
    }
}
