//-----------------------------------------------------------------------
// <copyright file="DbService.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Services.Database;

using System.Data;
using AliasClientDb;
using AliasClientDb.Models;
using AliasVault.Client.Services;
using AliasVault.Client.Services.Auth;
using AliasVault.Client.Services.JsInterop.Models;
using AliasVault.Client.Services.JsInterop.RustCore;
using AliasVault.Client.Services.JsInterop.RustCore.Models;
using AliasVault.Client.Services.VaultSync;
using AliasVault.Client.Services.VaultSync.Exceptions;
using AliasVault.Client.Services.VaultSync.Models;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Localization;

/// <summary>
/// Class to manage the in-memory AliasClientDb service. The reason for this service is to provide a way to interact
/// with a AliasClientDb database instance that is only persisted in memory due to the encryption requirements of the
/// database itself. The database should not be persisted to disk when in un-encrypted form.
/// </summary>
public sealed class DbService : IDisposable
{
    private const string _UNKNOWN_VERSION = "Unknown";

    /// <summary>
    /// How many times a save pulls, merges and pushes again after the server reported newer state before giving up.
    /// </summary>
    private const int MaxPushAttempts = 3;

    private readonly AuthService _authService;
    private readonly JsInteropService _jsInteropService;
    private readonly RustCoreService _rustCore;
    private readonly VaultSyncService _vaultSync;
    private readonly VaultKeyService _vaultKeyService;
    private readonly VaultSyncState _syncState;
    private readonly DbServiceState _state = new();
    private readonly Config _config;
    private readonly ILogger<DbService> _logger;
    private readonly GlobalNotificationService _globalNotificationService;
    private readonly IStringLocalizer _sharedLocalizer;
    private readonly CancellationTokenSource _backgroundSyncCts = new();
    private readonly SemaphoreSlim _saveLock = new(1, 1);
    private SettingsService _settingsService = new();
    private SqliteConnection? _sqlConnection;
    private AliasClientDbContext _dbContext;
    private bool _isSuccessfullyInitialized;
    private bool _forceFullWriteOnNextPush;
    private int _retryCount;
    private bool _disposed;

    /// <summary>
    /// Initializes a new instance of the <see cref="DbService"/> class.
    /// </summary>
    /// <param name="authService">AuthService.</param>
    /// <param name="jsInteropService">JsInteropService.</param>
    /// <param name="rustCore">RustCoreService for WASM interop.</param>
    /// <param name="vaultSync">VaultSyncService that pulls, pushes and merges the vault.</param>
    /// <param name="vaultKeyService">VaultKeyService that holds the account key chain.</param>
    /// <param name="syncState">The sync state recorded by the last pull or push.</param>
    /// <param name="config">Config instance.</param>
    /// <param name="globalNotificationService">Global notification service.</param>
    /// <param name="localizerFactory">IStringLocalizerFactory instance.</param>
    /// <param name="logger">ILogger instance.</param>
    public DbService(AuthService authService, JsInteropService jsInteropService, RustCoreService rustCore, VaultSyncService vaultSync, VaultKeyService vaultKeyService, VaultSyncState syncState, Config config, GlobalNotificationService globalNotificationService, IStringLocalizerFactory localizerFactory, ILogger<DbService> logger)
    {
        _authService = authService;
        _jsInteropService = jsInteropService;
        _rustCore = rustCore;
        _vaultSync = vaultSync;
        _vaultKeyService = vaultKeyService;
        _syncState = syncState;
        _config = config;
        _globalNotificationService = globalNotificationService;
        _sharedLocalizer = localizerFactory.Create("SharedResources", "AliasVault.Client");
        _logger = logger;

        // Set the initial state of the database service.
        _state.UpdateState(DbServiceState.DatabaseStatus.Uninitialized);

        // Create an in-memory SQLite database connection which stays open for the lifetime of the service.
        (_sqlConnection, _dbContext) = InitializeEmptyDatabase();
    }

    /// <summary>
    /// Gets the settings service instance which can be used to interact with general settings stored in the database.
    /// </summary>
    /// <returns>SettingsService.</returns>
    public SettingsService Settings => _settingsService;

    /// <summary>
    /// Gets the id of the user's personal manifest, the scope every row this client creates belongs to.
    /// </summary>
    /// <exception cref="InvalidOperationException">Thrown when no vault has been pulled yet.</exception>
    public Guid PersonalManifestId => _syncState.PersonalManifestId ?? throw new InvalidOperationException("No personal manifest id is recorded; the vault has not been loaded from the server yet.");

    /// <summary>
    /// Gets database service state object which can be subscribed to.
    /// </summary>
    /// <returns>DbServiceState instance.</returns>
    public DbServiceState GetState()
    {
        return _state;
    }

    /// <summary>
    /// Initializes the database, either by creating a new one or loading an existing one from the server.
    /// </summary>
    /// <returns>Task.</returns>
    public async Task InitializeDatabaseAsync()
    {
        // Check that encryption key is set. If not, do nothing.
        if (!_authService.IsEncryptionKeySet())
        {
            return;
        }

        // Attempt to fill the local database with a previously saved database stored on the server.
        var loaded = await LoadDatabaseFromServerAsync();
        if (loaded)
        {
            _retryCount = 0;
        }
    }

    /// <summary>
    /// Returns the AliasClientDbContext instance.
    /// </summary>
    /// <returns>AliasClientDbContext.</returns>
    public async Task<AliasClientDbContext> GetDbContextAsync()
    {
        if (!_isSuccessfullyInitialized)
        {
            // Retry initialization up to 5 times before giving up.
            if (_retryCount < 5)
            {
                _retryCount++;
                await InitializeDatabaseAsync();
            }
            else
            {
                throw new DataException("Failed to initialize database.");
            }
        }

        return _dbContext;
    }

    /// <summary>
    /// Saves the database to the remote server.
    /// </summary>
    /// <returns>Bool which indicates if saving database to server was successful.</returns>
    public async Task<bool> SaveDatabaseAsync()
    {
        if (_state.CurrentState.Status != DbServiceState.DatabaseStatus.Creating)
        {
            // If database is not in the process of being created, update status to saving which is reflected in the UI.
            _state.UpdateState(DbServiceState.DatabaseStatus.SavingToServer);
        }

        var success = await SaveAndPushAsync();
        if (success)
        {
            _logger.LogInformation("Database successfully saved to server.");
        }

        if (_state.CurrentState.Status != DbServiceState.DatabaseStatus.Creating)
        {
            // If database is not in the process of being created, update status to ready which is reflected in the UI.
            _state.UpdateState(DbServiceState.DatabaseStatus.Ready);
        }

        return success;
    }

    /// <summary>
    /// Saves the database to the remote server in the background without blocking the caller.
    /// The local database state is immediately persisted (in-memory), and the server sync happens asynchronously.
    /// If the sync fails, a notification is shown to the user.
    /// </summary>
    /// <remarks>
    /// This method is useful for operations where blocking the UI is undesirable, such as
    /// folder creation, settings changes, etc. The local mutation is considered immediately
    /// successful, and server sync happens in the background.
    /// </remarks>
    public void SaveDatabaseInBackground()
    {
        var creating = _state.CurrentState.Status == DbServiceState.DatabaseStatus.Creating;
        if (!creating)
        {
            // Set state to indicate background sync is pending
            _state.UpdateState(DbServiceState.DatabaseStatus.BackgroundSyncPending);
        }

        // Capture cancellation token for this background operation
        var cancellationToken = _backgroundSyncCts.Token;

        // Fire and forget the background save operation
        _ = Task.Run(
            async () =>
            {
                try
                {
                    if (cancellationToken.IsCancellationRequested || _disposed)
                    {
                        return;
                    }

                    var success = await SaveAndPushAsync();
                    if (success)
                    {
                        _logger.LogInformation("Database successfully saved to server (background sync).");
                    }
                    else
                    {
                        // SaveAndPushAsync already raised the user-facing error notification (targeted or generic).
                        _logger.LogWarning("Background sync to server failed.");
                    }

                    if (!creating && !_disposed)
                    {
                        _state.UpdateState(DbServiceState.DatabaseStatus.Ready);
                    }
                }
                catch (OperationCanceledException)
                {
                    // Background sync was cancelled (e.g., during logout), this is expected
                    _logger.LogDebug("Background database sync was cancelled.");
                }
                catch (Exception ex) when (_disposed || cancellationToken.IsCancellationRequested)
                {
                    // Service was disposed during sync, silently ignore
                    _logger.LogDebug(ex, "Background database sync aborted due to disposal.");
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Error during background database sync.");
                    _globalNotificationService.AddErrorMessage(_sharedLocalizer["ErrorUnknown"], true);
                    if (!creating)
                    {
                        _state.UpdateState(DbServiceState.DatabaseStatus.Ready);
                    }
                }
            },
            cancellationToken);
    }

    /// <summary>
    /// Runs VACUUM on the in-memory SQLite database to reclaim free pages
    /// after large deletes (e.g. vault reset, trash auto-prune). Without this
    /// the connection/vault keeps more memory allocated than necessary.
    /// </summary>
    /// <returns>Task.</returns>
    public async Task VacuumDatabaseAsync()
    {
        if (_sqlConnection is null)
        {
            return;
        }

        await using var command = _sqlConnection.CreateCommand();
        command.CommandText = "VACUUM";
        await command.ExecuteNonQueryAsync();
    }

    /// <summary>
    /// Export the in-memory SQLite database to a base64 string.
    /// </summary>
    /// <returns>Base64 encoded string that represents SQLite database.</returns>
    public async Task<string> ExportSqliteToBase64Async()
    {
        return await ExportConnectionToBase64Async(_sqlConnection!);
    }

    /// <summary>
    /// Creates a new vault with the latest schema.
    /// </summary>
    /// <returns>Bool which indicates if creating a new vault was successful.</returns>
    public async Task<bool> CreateNewVaultAsync()
    {
        try
        {
            // Every row this vault will hold is stamped with the personal manifest, so its id must be known up front.
            _ = PersonalManifestId;

            // Call JS interop to get SQL commands to create a new vault with the latest schema.
            var sqlCommands = await _jsInteropService.GetCreateVaultSqlAsync();

            // Execute the SQL commands to create a new vault with the latest schema.
            foreach (var sqlCommand in sqlCommands.SqlCommands)
            {
                await _dbContext.Database.ExecuteSqlRawAsync(sqlCommand);
            }

            // Init settings service.
            _isSuccessfullyInitialized = true;
            await _settingsService.InitializeAsync(this);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error creating new vault.");
            return false;
        }

        return true;
    }

    /// <summary>
    /// Migrate the loaded legacy vault onto the current storage model: walk the frozen sqlite-blob upgrade chain when
    /// the vault predates its end, then rebuild the database from its manifest-v1 form on the complete schema. The
    /// result is held locally until <see cref="SaveDatabaseAsync"/> pushes it, which also creates the account key chain
    /// for an account that has none yet.
    /// </summary>
    /// <returns>Bool which indicates if migration was successful.</returns>
    public async Task<bool> MigrateDatabaseAsync()
    {
        try
        {
            if (await HasPendingMigrationsAsync())
            {
                // LEGACY: the frozen sqlite-blob upgrade chain has to bring the vault to its end first; the codec cannot canonicalize what came before.
                var currentVersion = await GetCurrentDatabaseVersionAsync();
                var latestVersion = await _jsInteropService.GetLatestVaultVersionAsync();
                var sqlCommands = await _jsInteropService.GetUpgradeVaultSqlAsync(currentVersion.Revision, latestVersion.Revision);
                foreach (var sqlCommand in sqlCommands.SqlCommands)
                {
                    await _dbContext.Database.ExecuteSqlRawAsync(sqlCommand);
                }
            }

            // Rebuild on the complete schema via the codec; this stamps every row with the personal manifest.
            AdoptDatabase(await _vaultSync.MigrateVaultToCurrentSchemaAsync(_sqlConnection!));

            // The server holds no manifest-v1 state for this vault yet, so the next push must write everything.
            _forceFullWriteOnNextPush = true;
            _isSuccessfullyInitialized = true;
            await _settingsService.ReloadAsync(this);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error migrating database.");
            return false;
        }

        return true;
    }

    /// <summary>
    /// Get the current version (applied migration) of the database that is loaded in memory.
    /// Uses semantic versioning to allow backwards-compatible minor/patch versions.
    /// </summary>
    /// <returns>Version as string.</returns>
    public async Task<SqlVaultVersion> GetCurrentDatabaseVersionAsync()
    {
        var migrations = await _dbContext.Database.GetAppliedMigrationsAsync();
        var lastMigration = migrations.LastOrDefault();
        var currentVersion = _UNKNOWN_VERSION;

        // Convert migration Id in the form of "20240708094944_1.0.0-InitialMigration" to "1.0.0".
        if (lastMigration is not null)
        {
            var parts = lastMigration.Split('_');
            if (parts.Length > 1)
            {
                var versionPart = parts[1].Split('-')[0];
                if (Version.TryParse(versionPart, out _))
                {
                    currentVersion = versionPart;
                }
            }
        }

        // Check version compatibility using semantic versioning
        var isCompatible = await _jsInteropService.IsVersionCompatibleAsync(currentVersion);

        if (!isCompatible)
        {
            // Version is incompatible (different major version)
            return new SqlVaultVersion
            {
                Revision = 0,
                Version = _UNKNOWN_VERSION,
                Description = _UNKNOWN_VERSION,
                ReleaseVersion = _UNKNOWN_VERSION,
                CompatibleUpToVersion = _UNKNOWN_VERSION,
            };
        }

        // Get all available vault versions to get the revision number of the current version.
        var allVersions = await _jsInteropService.GetAllVaultVersionsAsync();
        var currentVersionRevision = allVersions.FirstOrDefault(v => v.Version == currentVersion);

        // If the version is known, return it
        if (currentVersionRevision is not null)
        {
            return currentVersionRevision;
        }

        /*
         * Version is unknown but compatible (same major version).
         * Create a version object with the actual database version but use the latest client's revision number.
         * This allows older clients to work with newer backwards-compatible database versions.
         */
        var latestClientVersion = await _jsInteropService.GetLatestVaultVersionAsync();

        // Return a version object with the actual database version string but the latest known revision
        return new SqlVaultVersion
        {
            Revision = latestClientVersion.Revision,
            Version = currentVersion, // Use the actual database version (e.g., "1.7.0")
            Description = $"Unknown version {currentVersion} (backwards compatible)",
            ReleaseVersion = latestClientVersion.ReleaseVersion,
            CompatibleUpToVersion = latestClientVersion.CompatibleUpToVersion,
        };
    }

    /// <summary>
    /// Get the latest available version (EF migration) as defined in code.
    /// </summary>
    /// <returns>Version as string.</returns>
    public async Task<SqlVaultVersion> GetLatestDatabaseVersionAsync()
    {
        var allVersions = await _jsInteropService.GetAllVaultVersionsAsync();
        var latestVersion = allVersions.LastOrDefault();

        return latestVersion ?? new SqlVaultVersion
        {
            Revision = 0,
            Version = _UNKNOWN_VERSION,
            Description = _UNKNOWN_VERSION,
            ReleaseVersion = _UNKNOWN_VERSION,
            CompatibleUpToVersion = _UNKNOWN_VERSION,
        };
    }

    /// <summary>
    /// Clears the database connection and creates a new one so that the database is empty.
    /// </summary>
    /// <returns>SqliteConnection and AliasClientDbContext.</returns>
    public (SqliteConnection SqliteConnection, AliasClientDbContext AliasClientDbContext) InitializeEmptyDatabase()
    {
        var connection = new SqliteConnection("Data Source=:memory:");
        connection.Open();
        SetLiveConnection(connection);
        _syncState.Clear();
        _forceFullWriteOnNextPush = false;

        // Reset the database state.
        _state.UpdateState(DbServiceState.DatabaseStatus.Uninitialized);
        _isSuccessfullyInitialized = false;

        // Reset settings.
        _settingsService = new();

        return (_sqlConnection!, _dbContext);
    }

    /// <summary>
    /// Get a list of private email addresses that are used in items by this vault.
    /// </summary>
    /// <returns>List of email addresses.</returns>
    public async Task<List<string>> GetEmailClaimListAsync()
    {
        // Send list of email addresses that are used in items by this vault, so they can be
        // claimed on the server.
        var emailAddresses = await _dbContext.FieldValues
            .Where(fv => fv.FieldKey == FieldKey.LoginEmail)
            .Where(fv => fv.Value != null)
            .Where(fv => !fv.IsDeleted)
            .Where(fv => !fv.Item.IsDeleted && fv.Item.DeletedAt == null)
            .Select(fv => fv.Value)
            .Distinct()
            .Select(email => email!)
            .ToListAsync();

        if (_config.PrivateEmailDomains.Count == 0)
        {
            return [];
        }

        if (_config.PrivateEmailDomains.Count == 1)
        {
            if (string.IsNullOrWhiteSpace(_config.PrivateEmailDomains[0]))
            {
                return [];
            }

            // TODO: "DISABLED.TLD" was a placeholder used < 0.22.0 that has been replaced by an empty string.
            // That value is still here for legacy purposes, but it can be removed from the codebase in a future release.
            if (_config.PrivateEmailDomains[0] == "DISABLED.TLD")
            {
                return [];
            }
        }

        // Filter the list of email addresses to only include those that are in the supported private email domains.
        return emailAddresses.Where(email => _config.PrivateEmailDomains.Exists(domain => email.EndsWith(domain))).ToList();
    }

    /// <summary>
    /// Implements the IDisposable interface.
    /// </summary>
    public void Dispose()
    {
        Dispose(true);
        GC.SuppressFinalize(this);
    }

    /// <summary>
    /// Export a given in-memory SQLite connection to a base64 string.
    /// </summary>
    /// <param name="connection">The SQLite connection to export.</param>
    /// <returns>Base64 encoded string that represents the SQLite database.</returns>
    private static async Task<string> ExportConnectionToBase64Async(SqliteConnection connection)
    {
        var tempFileName = Path.GetRandomFileName();

        // Export SQLite memory database to a temp file.
        await using var command = connection.CreateCommand();
        command.CommandText = "VACUUM main INTO @fileName";
        command.Parameters.Add(new SqliteParameter("@fileName", tempFileName));
        await command.ExecuteNonQueryAsync();

        // Get bytes.
        var bytes = await File.ReadAllBytesAsync(tempFileName);
        string base64String = Convert.ToBase64String(bytes);

        // Delete temp file.
        File.Delete(tempFileName);

        return base64String;
    }

    /// <summary>
    /// Imports a base64-encoded SQLite database into the given connection, replacing its contents.
    /// TODO: remove when all accounts have been migrated to the new manifest-v1 format.
    /// </summary>
    /// <param name="base64String">The base64-encoded SQLite database.</param>
    /// <param name="connection">The connection to import into.</param>
    /// <returns>Task.</returns>
    private static async Task ImportDbContextFromBase64Async(string base64String, SqliteConnection connection)
    {
        var bytes = Convert.FromBase64String(base64String);
        var tempFileName = Path.GetRandomFileName();
        await File.WriteAllBytesAsync(tempFileName, bytes);

        await using (var command = connection.CreateCommand())
        {
            // Disable foreign key constraints
            command.CommandText = "PRAGMA foreign_keys = OFF;";
            await command.ExecuteNonQueryAsync();

            // Drop all tables in the original database
            command.CommandText = @"
                SELECT 'DROP TABLE IF EXISTS ' || name || ';'
                FROM sqlite_master
                WHERE type = 'table' AND name NOT LIKE 'sqlite_%';";
            var dropTableCommands = new List<string>();
            await using (var reader = await command.ExecuteReaderAsync())
            {
                while (await reader.ReadAsync())
                {
                    dropTableCommands.Add(reader.GetString(0));
                }
            }

            foreach (var dropTableCommand in dropTableCommands)
            {
                command.CommandText = dropTableCommand;
                await command.ExecuteNonQueryAsync();
            }

            // Attach the imported database
            command.CommandText = "ATTACH DATABASE @fileName AS importDb";
            command.Parameters.Add(new SqliteParameter("@fileName", tempFileName));
            await command.ExecuteNonQueryAsync();

            // Get CREATE TABLE statements from the imported database
            command.CommandText = @"
                SELECT sql
                FROM importDb.sqlite_master
                WHERE type = 'table' AND name NOT LIKE 'sqlite_%';";
            var createTableCommands = new List<string>();
            await using (var reader = await command.ExecuteReaderAsync())
            {
                while (await reader.ReadAsync())
                {
                    createTableCommands.Add(reader.GetString(0));
                }
            }

            // Create tables in the main database
            foreach (var createTableCommand in createTableCommands)
            {
                command.CommandText = createTableCommand;
                await command.ExecuteNonQueryAsync();
            }

            // Copy data from imported database to main database
            command.CommandText = @"
                SELECT 'INSERT INTO main.' || name || ' SELECT * FROM importDb.' || name || ';'
                FROM importDb.sqlite_master
                WHERE type = 'table' AND name NOT LIKE 'sqlite_%';";
            var tableInsertCommands = new List<string>();
            await using (var reader = await command.ExecuteReaderAsync())
            {
                while (await reader.ReadAsync())
                {
                    tableInsertCommands.Add(reader.GetString(0));
                }
            }

            foreach (var tableInsertCommand in tableInsertCommands)
            {
                command.CommandText = tableInsertCommand;
                await command.ExecuteNonQueryAsync();
            }

            // Detach the imported database
            command.CommandText = "DETACH DATABASE importDb";
            await command.ExecuteNonQueryAsync();

            // Re-enable foreign key constraints
            command.CommandText = "PRAGMA foreign_keys = ON;";
            await command.ExecuteNonQueryAsync();
        }

        File.Delete(tempFileName);
    }

    /// <summary>
    /// Replace first occurrence of a string.
    /// </summary>
    /// <param name="text">The text to search in.</param>
    /// <param name="search">The string to search for.</param>
    /// <param name="replace">The replacement string.</param>
    /// <returns>The modified string.</returns>
    private static string ReplaceFirst(string text, string search, string replace)
    {
        int pos = text.IndexOf(search, StringComparison.Ordinal);
        if (pos < 0)
        {
            return text;
        }

        return text[..pos] + replace + text[(pos + search.Length)..];
    }

    /// <summary>
    /// Commit the pending EF changes and push the vault to the server, one save at a time. Saves that arrive while
    /// another is running wait for it, so two pushes never canonicalize the same database concurrently.
    /// </summary>
    /// <returns>True when the server holds the local vault afterwards.</returns>
    private async Task<bool> SaveAndPushAsync()
    {
        await _saveLock.WaitAsync();
        try
        {
            // Prune expired items from trash before saving.
            await PruneExpiredTrashItemsAsync();

            // Make sure a public/private RSA encryption key exists before saving the database.
            await EnsurePersonalEncryptionKeyAsync();
            await _dbContext.SaveChangesAsync();

            return await PushWithConflictResolutionAsync();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error saving database to server.");
            _globalNotificationService.AddErrorMessage(_sharedLocalizer["VaultSaveError"], true);
            return false;
        }
        finally
        {
            _saveLock.Release();
        }
    }

    /// <summary>
    /// Push the vault. When the server reports newer state, pull it, merge the local changes onto it and push again,
    /// a bounded number of times. Errors are reported to the user here so callers only need the bool.
    /// </summary>
    /// <returns>True when the push succeeded.</returns>
    private async Task<bool> PushWithConflictResolutionAsync()
    {
        for (var attempt = 1; attempt <= MaxPushAttempts; attempt++)
        {
            // LEGACY: an account without a key chain creates one on its first manifest-v1 push, unless another device already did.
            var createVaultKey = !await _vaultKeyService.HasLocalVaultKeyAsync() && !await TryAdoptRemoteVaultKeyAsync();

            PushResult result;
            try
            {
                result = await _vaultSync.PushAsync(_sqlConnection!, new PushOptions(createVaultKey, _forceFullWriteOnNextPush));
            }
            catch (VaultTooLargeException)
            {
                // 413: server / reverse-proxy rejected the upload because the vault exceeded MAX_UPLOAD_SIZE_MB.
                _logger.LogError("Vault upload rejected by server with 413 Request Entity Too Large. The vault exceeds the server's configured MAX_UPLOAD_SIZE_MB.");
                _globalNotificationService.AddErrorMessage(_sharedLocalizer["VaultTooLargeError"], true);
                return false;
            }
            catch (VaultKeyDecryptException ex)
            {
                _logger.LogError(ex, "The server's key chain does not open with this session's key; the password was changed elsewhere. Log in again.");
                _globalNotificationService.AddErrorMessage(_sharedLocalizer["VaultSaveError"], true);
                return false;
            }

            switch (result.Status)
            {
                case PushStatus.Ok:
                    _forceFullWriteOnNextPush = false;
                    return true;

                case PushStatus.Outdated:
                    _logger.LogInformation("Push attempt {Attempt}/{Max}: the server holds newer state ({Reasons}); pulling and merging.", attempt, MaxPushAttempts, string.Join("; ", result.Reasons ?? []));
                    if (attempt == MaxPushAttempts)
                    {
                        break;
                    }

                    await MergeWithServerAsync();
                    continue;

                default:
                    _logger.LogError("Vault push {Status}: {Reasons}", result.Status, string.Join("; ", result.Reasons ?? []));
                    _globalNotificationService.AddErrorMessage(_sharedLocalizer["VaultSaveError"], true);
                    return false;
            }
        }

        _logger.LogError("Vault push still outdated after {Max} attempts, giving up.", MaxPushAttempts);
        _globalNotificationService.AddErrorMessage(_sharedLocalizer["VaultSaveError"], true);
        return false;
    }

    /// <summary>
    /// Fetch the server vault and merge the local changes onto it; the merged database becomes the live one. When the
    /// server holds nothing to merge with (legacy format or a never-written manifest), the next push writes everything.
    /// </summary>
    /// <returns>Task.</returns>
    private async Task MergeWithServerAsync()
    {
        var result = await _vaultSync.PullAndMergeAsync(_sqlConnection!);
        if (result.Kind == PullAndMergeKind.NothingToMergeWith)
        {
            _logger.LogInformation("The server holds no manifest-v1 vault to merge with; pushing the local vault over it whole.");
            _forceFullWriteOnNextPush = true;
            return;
        }

        foreach (var manifestId in result.FallbackManifestIds)
        {
            _logger.LogWarning("Canonical merge fell back to the server's rows for manifest {ManifestId}; local changes to it were dropped.", manifestId);
        }

        AdoptDatabase(result.Database!);
        await _settingsService.ReloadAsync(this);
    }

    /// <summary>
    /// Adopt a key chain the server holds but this device does not: the account was migrated on another device while
    /// this session still holds the old password-derived key, which opens the chain as its KEK.
    /// </summary>
    /// <returns>True when a chain was adopted, false when the server holds none.</returns>
    /// <exception cref="VaultKeyDecryptException">Thrown when the server's chain does not open with the session key.</exception>
    private async Task<bool> TryAdoptRemoteVaultKeyAsync()
    {
        var resolved = await _vaultKeyService.AdoptRemoteVaultKeyAsync(_authService.GetEncryptionKeyAsBase64Async());
        if (resolved is null)
        {
            return false;
        }

        _logger.LogInformation("Adopted the account key chain another device created; the session key is now the VEK.");
        await _authService.StoreSessionKeysAsync(resolved);
        return true;
    }

    /// <summary>
    /// Checks if there are any pending migrations of the frozen sqlite-blob upgrade chain.
    /// </summary>
    /// <returns>Bool which indicates if there are any pending migrations.</returns>
    private async Task<bool> HasPendingMigrationsAsync()
    {
        // Get current version of database.
        var currentVersion = await GetCurrentDatabaseVersionAsync();
        if (currentVersion.Revision == 0)
        {
            // Revision 0 means current version could not be found because it's unknown
            // by the current client, most likely a newer version. Throw error.
            throw new DataException("Current vault version could not be determined.");
        }

        // Get latest version from JsInteropService.
        var latestVersion = await _jsInteropService.GetLatestVaultVersionAsync();

        return currentVersion.Revision < latestVersion.Revision;
    }

    /// <summary>
    /// Loads the database from the server.
    /// </summary>
    /// <returns>True when the database is ready for use.</returns>
    private async Task<bool> LoadDatabaseFromServerAsync()
    {
        _state.UpdateState(DbServiceState.DatabaseStatus.Loading);
        _logger.LogInformation("Loading database from server...");

        PullResult pull;
        try
        {
            pull = await _vaultSync.PullAsync();
        }
        catch (VaultProcessingException ex)
        {
            // The snapshot was fetched but could not be opened locally: surface the technical detail as a support report.
            _logger.LogError(ex, "Error processing the vault snapshot.");
            _state.UpdateState(DbServiceState.DatabaseStatus.DecryptionFailed, ex.ToReport());
            return false;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error loading database from server.");
            _state.UpdateState(DbServiceState.DatabaseStatus.DecryptionFailed);
            return false;
        }

        try
        {
            switch (pull.Kind)
            {
                case PullKind.Empty:
                    // The vault was never written: create the database structure from scratch to get an empty ready-to-use database.
                    _state.UpdateState(DbServiceState.DatabaseStatus.Creating);
                    return false;

                case PullKind.LegacySqliteBlob:
                    return await LoadLegacySqliteBlobAsync(pull);

                default:
                    SetLiveConnection(pull.Database!);
                    _isSuccessfullyInitialized = true;
                    await _settingsService.InitializeAsync(this);
                    _state.UpdateState(DbServiceState.DatabaseStatus.Ready);
                    return true;
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error loading database from server.");
            _state.UpdateState(DbServiceState.DatabaseStatus.DecryptionFailed);
            return false;
        }
    }

    /// <summary>
    /// Import an account's not-yet-migrated sqlite-blob vault. The derived key is the encryption key for these
    /// accounts. A legacy vault cannot be saved before it is migrated onto the manifest-v1 storage model, so it
    /// always lands on the upgrade page. TODO: remove when all accounts have been migrated to the new manifest-v1 format.
    /// </summary>
    /// <param name="pull">The pass-through pull result.</param>
    /// <returns>True when the database is ready for use.</returns>
    private async Task<bool> LoadLegacySqliteBlobAsync(PullResult pull)
    {
        // An account that registered but never uploaded a vault: create the database structure from scratch.
        if (string.IsNullOrEmpty(pull.LegacyVaultBlob))
        {
            _state.UpdateState(DbServiceState.DatabaseStatus.Creating);
            return false;
        }

        // Attempt to decrypt the database blob.
        string decryptedBase64String = await _jsInteropService.SymmetricDecrypt(pull.LegacyVaultBlob, _authService.GetEncryptionKeyAsBase64Async());
        await ImportDbContextFromBase64Async(decryptedBase64String, _sqlConnection!);

        // Refresh the db context with the new database to invalidate any cached data if the _dbContext was already used.
        _dbContext = CreateDbContext(_sqlConnection!);

        // A vault this client cannot place on the upgrade chain (newer major version) cannot be migrated either.
        try
        {
            await HasPendingMigrationsAsync();
        }
        catch (DataException)
        {
            _state.UpdateState(DbServiceState.DatabaseStatus.VaultVersionUnrecognized);
            return false;
        }

        _state.UpdateState(DbServiceState.DatabaseStatus.PendingMigrations);
        return false;
    }

    /// <summary>
    /// Make the given open connection the live database, replacing (and disposing) the previous one.
    /// </summary>
    /// <param name="connection">The open in-memory connection to make live.</param>
    private void SetLiveConnection(SqliteConnection connection)
    {
        var previous = _sqlConnection;
        _sqlConnection = connection;
        _dbContext = CreateDbContext(connection);

        if (previous is not null && !ReferenceEquals(previous, connection))
        {
            previous.Dispose();
        }
    }

    /// <summary>
    /// Copy another database into the live connection and refresh the context over it. The connection object stays
    /// the same, so a context handed out earlier keeps working and simply sees the new content.
    /// </summary>
    /// <param name="source">The open in-memory database to adopt; disposed afterwards.</param>
    private void AdoptDatabase(SqliteConnection source)
    {
        source.BackupDatabase(_sqlConnection!);
        source.Dispose();
        _dbContext = CreateDbContext(_sqlConnection!);
    }

    /// <summary>
    /// Create the EF context over a connection, with every save stamping new rows with their manifest.
    /// </summary>
    /// <param name="connection">The open connection.</param>
    /// <returns>The context.</returns>
    private AliasClientDbContext CreateDbContext(SqliteConnection connection)
    {
        var context = new AliasClientDbContext(connection, log => _logger.LogDebug("{Message}", log));
        context.SavingChanges += (sender, _) => ManifestStamper.Stamp((DbContext)sender!, PersonalManifestId);
        return context;
    }

    /// <summary>
    /// Prunes expired items from the trash.
    /// Items that have been in trash (DeletedAt set) for longer than the
    /// configured <see cref="Config.TrashRetentionDays"/> are permanently
    /// deleted (IsDeleted = true).
    /// </summary>
    /// <returns>A <see cref="Task"/> representing the asynchronous operation.</returns>
    private async Task PruneExpiredTrashItemsAsync()
    {
        try
        {
            // Read table data for prune operation
            var tables = await ReadPruneTablesAsJsonAsync(_sqlConnection!);

            var pruneInput = new PruneInput
            {
                Tables = tables,
                RetentionDays = _config.TrashRetentionDays,
                CurrentTime = DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ"),
            };

            var pruneOutput = await _rustCore.PruneVaultAsync(pruneInput);

            if (pruneOutput.Success && pruneOutput.Statements.Count > 0)
            {
                _logger.LogInformation("Pruning {StatementCount} expired items from trash.", pruneOutput.Statements.Count);

                // Execute the SQL statements returned by Rust
                foreach (var stmt in pruneOutput.Statements)
                {
                    await using var command = _sqlConnection!.CreateCommand();
                    command.CommandText = stmt.Sql;

                    for (int i = 0; i < stmt.Params.Count; i++)
                    {
                        var param = stmt.Params[i];
                        command.Parameters.AddWithValue($"@p{i}", param?.ToString() ?? (object)DBNull.Value);
                    }

                    // Replace ? placeholders with @p0, @p1, etc.
                    var parameterizedSql = stmt.Sql;
                    for (int i = 0; i < stmt.Params.Count; i++)
                    {
                        parameterizedSql = ReplaceFirst(parameterizedSql, "?", $"@p{i}");
                    }

                    command.CommandText = parameterizedSql;
                    await command.ExecuteNonQueryAsync();
                }

                // Trash pruning hard-deletes rows (including attachments/passkeys).
                // Reclaim the freed pages so the live in-memory DB shrinks.
                await VacuumDatabaseAsync();
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to prune expired trash items. Continuing with save.");
        }
    }

    /// <summary>
    /// Make sure the personal manifest holds its email delivery keypair; create one when it does not.
    /// </summary>
    /// <returns>A <see cref="Task"/> representing the asynchronous operation.</returns>
    private async Task EnsurePersonalEncryptionKeyAsync()
    {
        var personalManifestId = PersonalManifestId;
        var encryptionKey = await _dbContext.EncryptionKeys.FirstOrDefaultAsync(x => x.ManifestId == personalManifestId && x.IsPrimary && !x.IsDeleted);
        if (encryptionKey is not null)
        {
            return;
        }

        // Create a new encryption key via JSInterop, .NET WASM does not support crypto operations natively (yet).
        var keyPair = await _jsInteropService.GenerateRsaKeyPair();

        var currentDateTime = DateTime.UtcNow;
        _dbContext.EncryptionKeys.Add(new EncryptionKey
        {
            Id = Guid.NewGuid(),
            ManifestId = personalManifestId,
            PublicKey = keyPair.PublicKey,
            PrivateKey = keyPair.PrivateKey,
            IsPrimary = true,
            CreatedAt = currentDateTime,
            UpdatedAt = currentDateTime,
        });
    }

    /// <summary>
    /// Get the per-table SELECT queries clients should run to build `PruneInput`.
    /// </summary>
    /// <param name="connection">The SQLite connection to read from.</param>
    /// <returns>List of TableData objects containing the trimmed table records.</returns>
    private async Task<List<TableData>> ReadPruneTablesAsJsonAsync(SqliteConnection connection)
    {
        var tableQueries = await _rustCore.GetPruneTableQueriesAsync();

        var tables = new List<TableData>();

        foreach (var tableQuery in tableQueries)
        {
            var tableName = tableQuery.Name;
            var query = tableQuery.Query;
            var tableData = new TableData { Name = tableName };

            // Check if table exists in the database.
            await using var checkCommand = connection.CreateCommand();
            checkCommand.CommandText = "SELECT name FROM sqlite_master WHERE type='table' AND name=@tableName";
            checkCommand.Parameters.AddWithValue("@tableName", tableName);
            var exists = await checkCommand.ExecuteScalarAsync();

            if (exists == null)
            {
                // Table doesn't exist, add empty table data.
                tables.Add(tableData);
                continue;
            }

            await using var selectCommand = connection.CreateCommand();
            selectCommand.CommandText = query;
            await using var reader = await selectCommand.ExecuteReaderAsync();

            while (await reader.ReadAsync())
            {
                var record = new Dictionary<string, object?>();
                for (var i = 0; i < reader.FieldCount; i++)
                {
                    var value = reader.GetValue(i);

                    // Convert DBNull to null for proper JSON serialization.
                    record[reader.GetName(i)] = value == DBNull.Value ? null : value;
                }

                tableData.Records.Add(record);
            }

            tables.Add(tableData);
        }

        return tables;
    }

    /// <summary>
    /// Disposes the service.
    /// </summary>
    /// <param name="disposing">True if disposing.</param>
    private void Dispose(bool disposing)
    {
        if (_disposed)
        {
            return;
        }

        if (disposing)
        {
            // Cancel any pending background sync operations first
            _backgroundSyncCts.Cancel();
            _backgroundSyncCts.Dispose();
            _saveLock.Dispose();
            _sqlConnection?.Dispose();
        }

        _disposed = true;
    }
}
