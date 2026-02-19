//-----------------------------------------------------------------------
// <copyright file="DbService.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Services.Database;

using System.Data;
using System.Net.Http.Json;
using System.Text.Json;
using AliasClientDb;
using AliasClientDb.Models;
using AliasVault.Client.Services;
using AliasVault.Client.Services.Auth;
using AliasVault.Client.Services.JsInterop.Models;
using AliasVault.Client.Services.JsInterop.RustCore;
using AliasVault.Client.Utilities;
using AliasVault.Shared.Models.Enums;
using AliasVault.Shared.Models.WebApi.Vault;
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
    private readonly AuthService _authService;
    private readonly JsInteropService _jsInteropService;
    private readonly RustCoreService _rustCore;
    private readonly HttpClient _httpClient;
    private readonly DbServiceState _state = new();
    private readonly Config _config;
    private readonly ILogger<DbService> _logger;
    private readonly GlobalNotificationService _globalNotificationService;
    private readonly IStringLocalizer _sharedLocalizer;
    private readonly CancellationTokenSource _backgroundSyncCts = new();
    private SettingsService _settingsService = new();
    private SqliteConnection? _sqlConnection;
    private AliasClientDbContext _dbContext;
    private long _vaultRevisionNumber;
    private bool _isSuccessfullyInitialized;
    private int _retryCount;
    private bool _disposed;

    /// <summary>
    /// Initializes a new instance of the <see cref="DbService"/> class.
    /// </summary>
    /// <param name="authService">AuthService.</param>
    /// <param name="jsInteropService">JsInteropService.</param>
    /// <param name="rustCore">RustCoreService for WASM interop.</param>
    /// <param name="httpClient">HttpClient.</param>
    /// <param name="config">Config instance.</param>
    /// <param name="globalNotificationService">Global notification service.</param>
    /// <param name="localizerFactory">IStringLocalizerFactory instance.</param>
    /// <param name="logger">ILogger instance.</param>
    public DbService(AuthService authService, JsInteropService jsInteropService, RustCoreService rustCore, HttpClient httpClient, Config config, GlobalNotificationService globalNotificationService, IStringLocalizerFactory localizerFactory, ILogger<DbService> logger)
    {
        _authService = authService;
        _jsInteropService = jsInteropService;
        _rustCore = rustCore;
        _httpClient = httpClient;
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
    /// Stores / updates the vault revision number. Should be called after a successful vault update to the server.
    /// </summary>
    /// <param name="newRevisionNumber">New revision number.</param>
    public void StoreVaultRevisionNumber(long newRevisionNumber)
    {
        _vaultRevisionNumber = newRevisionNumber;
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
    /// Generate encrypted base64 string representation of current state of database in order to save it
    /// to the server.
    /// </summary>
    /// <returns>Base64 encoded vault blob.</returns>
    public async Task<string> GetEncryptedDatabaseBase64String()
    {
        // Save the actual dbContext.
        await _dbContext.SaveChangesAsync();

        string base64String = await ExportSqliteToBase64Async();

        // SymmetricEncrypt base64 string using IJSInterop.
        return await _jsInteropService.SymmetricEncrypt(base64String, _authService.GetEncryptionKeyAsBase64Async());
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

        // Prune expired items from trash before saving.
        await PruneExpiredTrashItemsAsync();

        // Make sure a public/private RSA encryption key exists before saving the database.
        await GetOrCreateEncryptionKeyAsync();

        var encryptedBase64String = await GetEncryptedDatabaseBase64String();

        // Save to webapi.
        var success = await SaveToServerAsync(encryptedBase64String);
        if (success)
        {
            _logger.LogInformation("Database successfully saved to server.");
            if (_state.CurrentState.Status != DbServiceState.DatabaseStatus.Creating)
            {
                // If database is not in the process of being created, update status to ready which is reflected in the UI.
                _state.UpdateState(DbServiceState.DatabaseStatus.Ready);
            }
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
        // Set state to indicate background sync is pending
        _state.UpdateState(DbServiceState.DatabaseStatus.BackgroundSyncPending);

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

                    // Prune expired items from trash before saving.
                    await PruneExpiredTrashItemsAsync();

                    if (cancellationToken.IsCancellationRequested || _disposed)
                    {
                        return;
                    }

                    // Make sure a public/private RSA encryption key exists before saving the database.
                    await GetOrCreateEncryptionKeyAsync();

                    if (cancellationToken.IsCancellationRequested || _disposed)
                    {
                        return;
                    }

                    var encryptedBase64String = await GetEncryptedDatabaseBase64String();

                    if (cancellationToken.IsCancellationRequested || _disposed)
                    {
                        return;
                    }

                    // Update state to show we're actively syncing
                    _state.UpdateState(DbServiceState.DatabaseStatus.SavingToServer);

                    // Save to webapi.
                    var success = await SaveToServerAsync(encryptedBase64String);
                    if (success)
                    {
                        _logger.LogInformation("Database successfully saved to server (background sync).");
                        _state.UpdateState(DbServiceState.DatabaseStatus.Ready);
                    }
                    else
                    {
                        _logger.LogWarning("Background sync to server failed.");
                        _globalNotificationService.AddErrorMessage(
                            "Failed to sync changes to server. Your changes are saved locally and will be synced on next refresh.");
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
                    _globalNotificationService.AddErrorMessage(_sharedLocalizer["ErrorUnknown"]);
                    _state.UpdateState(DbServiceState.DatabaseStatus.Ready);
                }
            },
            cancellationToken);
    }

    /// <summary>
    /// Export the in-memory SQLite database to a base64 string.
    /// </summary>
    /// <returns>Base64 encoded string that represents SQLite database.</returns>
    public async Task<string> ExportSqliteToBase64Async()
    {
        var tempFileName = Path.GetRandomFileName();

        // Export SQLite memory database to a temp file.
        using var memoryStream = new MemoryStream();
        await using var command = _sqlConnection!.CreateCommand();
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
    /// Creates a new vault with the latest schema.
    /// </summary>
    /// <returns>Bool which indicates if creating a new vault was successful.</returns>
    public async Task<bool> CreateNewVaultAsync()
    {
        try
        {
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
    /// Migrate the database structure to the latest version.
    /// </summary>
    /// <returns>Bool which indicates if migration was successful.</returns>
    public async Task<bool> MigrateDatabaseAsync()
    {
        try
        {
            // Get current version of database.
            var currentVersion = await GetCurrentDatabaseVersionAsync();

            // Get latest version from JsInteropService.
            var latestVersion = await _jsInteropService.GetLatestVaultVersionAsync();

            // Call JS interop to get SQL commands to create a new vault with the latest schema.
            var sqlCommands = await _jsInteropService.GetUpgradeVaultSqlAsync(currentVersion.Revision, latestVersion.Revision);

            // Execute the SQL commands to create a new vault with the latest schema.
            foreach (var sqlCommand in sqlCommands.SqlCommands)
            {
                await _dbContext.Database.ExecuteSqlRawAsync(sqlCommand);
            }

            _isSuccessfullyInitialized = true;
            await _settingsService.InitializeAsync(this);
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
    /// Prepare a vault object for upload to the server.
    /// </summary>
    /// <param name="encryptedDatabase">Encrypted database as string.</param>
    /// <returns>Vault object.</returns>
    public async Task<Vault> PrepareVaultForUploadAsync(string encryptedDatabase)
    {
        var username = _authService.GetUsername();
        var databaseVersion = await GetCurrentDatabaseVersionAsync();
        var encryptionKey = await GetOrCreateEncryptionKeyAsync();
        var credentialsCount = await _dbContext.Items.Where(x => !x.IsDeleted && x.DeletedAt == null).CountAsync();
        var emailAddresses = await GetEmailClaimListAsync();
        var currentDateTime = DateTime.UtcNow;
        return new Vault
        {
            Username = username,
            Blob = encryptedDatabase,
            Version = databaseVersion.Version,
            CurrentRevisionNumber = _vaultRevisionNumber,
            EncryptionPublicKey = encryptionKey.PublicKey,
            CredentialsCount = credentialsCount,
            EmailAddressList = emailAddresses,
            PrivateEmailDomainList = [],
            HiddenPrivateEmailDomainList = [],
            PublicEmailDomainList = [],
            CreatedAt = currentDateTime,
            UpdatedAt = currentDateTime,
        };
    }

    /// <summary>
    /// Clears the database connection and creates a new one so that the database is empty.
    /// </summary>
    /// <returns>SqliteConnection and AliasClientDbContext.</returns>
    public (SqliteConnection SqliteConnection, AliasClientDbContext AliasClientDbContext) InitializeEmptyDatabase()
    {
        if (_sqlConnection?.State == ConnectionState.Open)
        {
            _sqlConnection.Close();
            _sqlConnection.Dispose();
        }

        _sqlConnection = new SqliteConnection("Data Source=:memory:");
        _sqlConnection.Open();

        _dbContext = new AliasClientDbContext(_sqlConnection, log => _logger.LogDebug("{Message}", log));

        // Reset the database state.
        _state.UpdateState(DbServiceState.DatabaseStatus.Uninitialized);
        _isSuccessfullyInitialized = false;

        // Reset settings.
        _settingsService = new();

        return (_sqlConnection, _dbContext);
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
    /// Loads a SQLite database from a base64 string which represents a .sqlite file.
    /// </summary>
    /// <param name="base64String">Base64 string representation of a .sqlite file.</param>
    /// <param name="connection">The connection to the database that should be used for the import.</param>
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
    /// Converts a JsonElement to its appropriate .NET value for SQLite parameters.
    /// </summary>
    /// <param name="element">The JsonElement to convert.</param>
    /// <returns>The converted value.</returns>
    private static object? ConvertJsonElementToValue(JsonElement element)
    {
        return element.ValueKind switch
        {
            JsonValueKind.String => element.GetString(),
            JsonValueKind.Number => element.TryGetInt64(out var longVal) ? longVal : element.GetDouble(),
            JsonValueKind.True => 1L, // SQLite stores booleans as integers
            JsonValueKind.False => 0L,
            JsonValueKind.Null => null,
            JsonValueKind.Undefined => null,
            _ => element.ToString(),
        };
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
    /// Fetches the latest vault from server, merges with local changes using Rust WASM, and saves the merged result.
    /// Called when server responds with "Outdated" status, indicating another client has uploaded a newer vault.
    /// </summary>
    /// <returns>Bool which indicates if merge and save was successful.</returns>
    private async Task<bool> MergeWithServerAndSaveAsync()
    {
        try
        {
            _logger.LogInformation("Local vault is outdated. Fetching latest vault from server for merge...");

            // Fetch the latest vault from server.
            var response = await _httpClient.GetFromJsonAsync<VaultGetResponse>("v1/Vault");
            if (response?.Vault == null || string.IsNullOrEmpty(response.Vault.Blob))
            {
                _logger.LogError("Failed to fetch vault from server for merge.");
                _globalNotificationService.AddErrorMessage(_sharedLocalizer["ErrorUnknown"]);
                return false;
            }

            var serverVault = response.Vault;
            _logger.LogInformation("Fetched server vault at revision {Revision}.", serverVault.CurrentRevisionNumber);

            // Store username of the loaded vault in memory to send to server as sanity check when updating the vault later.
            _authService.StoreUsername(serverVault.Username);

            // Decrypt server vault.
            var decryptedBase64String = await _jsInteropService.SymmetricDecrypt(serverVault.Blob, _authService.GetEncryptionKeyAsBase64Async());

            // Get the list of syncable table names from Rust core.
            var tableNames = await _rustCore.GetSyncableTableNamesAsync();

            // Read local tables as JSON.
            var localTables = await ReadTablesAsJsonAsync(_sqlConnection!, tableNames);
            _logger.LogDebug("Read {Count} local tables.", localTables.Count);

            // Create a temporary in-memory SQLite database for the server vault.
            await using var serverConnection = new SqliteConnection("Data Source=:memory:");
            await serverConnection.OpenAsync();
            await ImportDbContextFromBase64Async(decryptedBase64String, serverConnection);

            // Read server tables as JSON.
            var serverTables = await ReadTablesAsJsonAsync(serverConnection, tableNames);
            _logger.LogDebug("Read {Count} server tables.", serverTables.Count);

            // Create the merge input (local has our pending changes, server has the latest).
            var mergeInput = new MergeInput
            {
                LocalTables = localTables,
                ServerTables = serverTables,
            };

            // Call Rust WASM merge (LWW - Last Write Wins based on UpdatedAt).
            var mergeOutput = await _rustCore.MergeVaultsAsync(mergeInput);

            _logger.LogInformation(
                "Merge completed: {TablesProcessed} tables, {FromLocal} kept local, {FromServer} from server, {Inserted} inserted, {Conflicts} conflicts.",
                mergeOutput.Stats.TablesProcessed,
                mergeOutput.Stats.RecordsFromLocal,
                mergeOutput.Stats.RecordsFromServer,
                mergeOutput.Stats.RecordsInserted,
                mergeOutput.Stats.Conflicts);

            // Execute the SQL statements returned by the merge to update local database.
            await ExecuteMergeSqlStatementsAsync(mergeOutput.Statements);

            // Verify foreign key integrity after merge.
            await using (var command = _sqlConnection!.CreateCommand())
            {
                command.CommandText = "PRAGMA foreign_key_check;";
                await using var reader = await command.ExecuteReaderAsync();
                if (await reader.ReadAsync())
                {
                    _logger.LogError("Foreign key violation detected after merge.");
                    _globalNotificationService.AddErrorMessage(_sharedLocalizer["ErrorUnknown"]);
                    return false;
                }
            }

            // Update the db context with the merged database.
            _dbContext = new AliasClientDbContext(_sqlConnection, log => _logger.LogDebug("{Message}", log));

            // Update the local revision number to the server's revision.
            // When we upload, server will calculate new revision = this + 1.
            StoreVaultRevisionNumber(serverVault.CurrentRevisionNumber);

            _logger.LogInformation("Local merge completed. Uploading merged vault to server...");

            // Now save the merged vault to server. This recursive call handles the case where
            // another client uploaded during our merge (returns Outdated again).
            return await SaveDatabaseAsync();
        }
        catch (Exception ex)
        {
            _globalNotificationService.AddErrorMessage(_sharedLocalizer["ErrorUnknown"]);
            _logger.LogError(ex, "Error merging with server vault.");
            return false;
        }
    }

    /// <summary>
    /// Checks if there are any pending migrations.
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
    /// <returns>Task.</returns>
    private async Task<bool> LoadDatabaseFromServerAsync()
    {
        _state.UpdateState(DbServiceState.DatabaseStatus.Loading);
        _logger.LogInformation("Loading database from server...");

        // Load from webapi.
        try
        {
            var response = await _httpClient.GetFromJsonAsync<VaultGetResponse>("v1/Vault");
            if (response is not null)
            {
                var vault = response.Vault!;
                StoreVaultRevisionNumber(vault.CurrentRevisionNumber);

                // Store username of the loaded vault in memory to send to server as sanity check when updating the vault later.
                _authService.StoreUsername(vault.Username);

                // Check if vault blob is empty, if so, we don't need to do anything and the initial vault created
                // on client is sufficient.
                if (string.IsNullOrEmpty(vault.Blob))
                {
                    // Create the database structure from scratch to get an empty ready-to-use database.
                    _state.UpdateState(DbServiceState.DatabaseStatus.Creating);
                    return false;
                }

                // Attempt to decrypt the database blob.
                string decryptedBase64String = await _jsInteropService.SymmetricDecrypt(vault.Blob, _authService.GetEncryptionKeyAsBase64Async());
                await ImportDbContextFromBase64Async(decryptedBase64String, _sqlConnection!);

                // Refresh the db context with the new database to invalidate any cached data if the _dbContext was already used.
                _dbContext = new AliasClientDbContext(_sqlConnection!, log => _logger.LogDebug("{Message}", log));

                // Check if database is up-to-date with migrations.
                try
                {
                    if (await HasPendingMigrationsAsync())
                    {
                        _state.UpdateState(DbServiceState.DatabaseStatus.PendingMigrations);
                        return false;
                    }
                }
                catch (DataException)
                {
                    _state.UpdateState(DbServiceState.DatabaseStatus.VaultVersionUnrecognized);
                    return false;
                }

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

        return false;
    }

    /// <summary>
    /// Saves encrypted database blob to server and updates the local revision number.
    /// </summary>
    /// <param name="encryptedDatabase">Encrypted database as string.</param>
    /// <returns>True if save action succeeded and revision number was updated, false otherwise.</returns>
    private async Task<bool> SaveToServerAsync(string encryptedDatabase)
    {
        var vaultObject = await PrepareVaultForUploadAsync(encryptedDatabase);

        try
        {
            var response = await _httpClient.PostAsJsonAsync("v1/Vault", vaultObject);

            // Ensure the request was successful
            response.EnsureSuccessStatusCode();

            // Deserialize the response content
            var vaultUpdateResponse = await response.Content.ReadFromJsonAsync<VaultUpdateResponse>();

            if (vaultUpdateResponse != null)
            {
                if (vaultUpdateResponse.Status == VaultStatus.Outdated)
                {
                    // Server has a newer vault. Fetch it, merge with our local changes, and re-upload.
                    // The merge uses LWW (Last Write Wins) based on UpdatedAt timestamps.
                    return await MergeWithServerAndSaveAsync();
                }

                _vaultRevisionNumber = vaultUpdateResponse.NewRevisionNumber;
                return true;
            }

            _logger.LogError("Error during save: server response was empty or could not be deserialized.");
            return false;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error saving database to server.");
            return false;
        }
    }

    /// <summary>
    /// Prunes expired items from the trash.
    /// Items that have been in trash (DeletedAt set) for longer than 30 days
    /// are permanently deleted (IsDeleted = true).
    /// </summary>
    /// <returns>A <see cref="Task"/> representing the asynchronous operation.</returns>
    private async Task PruneExpiredTrashItemsAsync()
    {
        try
        {
            // Read table data for prune operation
            var tableNames = new[] { "Items", "FieldValues", "Attachments", "TotpCodes", "Passkeys" };
            var tables = await ReadTablesAsJsonAsync(_sqlConnection!, tableNames);

            var pruneInput = new JsInterop.RustCore.PruneInput
            {
                Tables = tables,
                RetentionDays = 30,
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
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to prune expired trash items. Continuing with save.");
        }
    }

    /// <summary>
    /// Get the default public/private encryption key, if it does not yet exist, create it.
    /// </summary>
    /// <returns>A <see cref="Task"/> representing the asynchronous operation.</returns>
    private async Task<EncryptionKey> GetOrCreateEncryptionKeyAsync()
    {
        var encryptionKey = await _dbContext.EncryptionKeys.FirstOrDefaultAsync(x => x.IsPrimary);
        if (encryptionKey is not null)
        {
            return encryptionKey;
        }

        // Create a new encryption key via JSInterop, .NET WASM does not support crypto operations natively (yet).
        var keyPair = await _jsInteropService.GenerateRsaKeyPair();

        var currentDateTime = DateTime.UtcNow;
        encryptionKey = new EncryptionKey
        {
            PublicKey = keyPair.PublicKey,
            PrivateKey = keyPair.PrivateKey,
            IsPrimary = true,
            CreatedAt = currentDateTime,
            UpdatedAt = currentDateTime,
        };
        _dbContext.EncryptionKeys.Add(encryptionKey);
        return encryptionKey;
    }

    /// <summary>
    /// Reads all specified tables from a SQLite connection as JSON data for the Rust merge.
    /// </summary>
    /// <param name="connection">The SQLite connection to read from.</param>
    /// <param name="tableNames">The names of tables to read.</param>
    /// <returns>List of TableData objects containing the table records.</returns>
    private async Task<List<TableData>> ReadTablesAsJsonAsync(SqliteConnection connection, string[] tableNames)
    {
        var tables = new List<TableData>();

        foreach (var tableName in tableNames)
        {
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

            // Get column names for the table.
            await using var columnsCommand = connection.CreateCommand();
            columnsCommand.CommandText = $"PRAGMA table_info({tableName})";
            var columns = new List<string>();
            await using (var columnsReader = await columnsCommand.ExecuteReaderAsync())
            {
                while (await columnsReader.ReadAsync())
                {
                    columns.Add(columnsReader.GetString(1));
                }
            }

            // Read all records from the table.
            await using var selectCommand = connection.CreateCommand();
            selectCommand.CommandText = $"SELECT * FROM {tableName}";
            await using var reader = await selectCommand.ExecuteReaderAsync();

            while (await reader.ReadAsync())
            {
                var record = new Dictionary<string, object?>();
                for (var i = 0; i < columns.Count; i++)
                {
                    var value = reader.GetValue(i);

                    // Convert DBNull to null for proper JSON serialization.
                    record[columns[i]] = value == DBNull.Value ? null : value;
                }

                tableData.Records.Add(record);
            }

            tables.Add(tableData);
        }

        return tables;
    }

    /// <summary>
    /// Executes the SQL statements returned by the Rust merge operation.
    /// </summary>
    /// <param name="statements">The SQL statements to execute.</param>
    /// <returns>Task.</returns>
    private async Task ExecuteMergeSqlStatementsAsync(List<SqlStatement> statements)
    {
        if (statements.Count == 0)
        {
            _logger.LogDebug("No SQL statements to execute from merge.");
            return;
        }

        _logger.LogDebug("Executing {Count} SQL statements from merge.", statements.Count);

        // Disable foreign key checks during merge execution.
        await using (var pragmaCommand = _sqlConnection!.CreateCommand())
        {
            pragmaCommand.CommandText = "PRAGMA foreign_keys = OFF;";
            await pragmaCommand.ExecuteNonQueryAsync();
        }

        try
        {
            foreach (var statement in statements)
            {
                await using var command = _sqlConnection!.CreateCommand();
                command.CommandText = statement.Sql;

                // Add parameters in order (SQLite uses positional parameters with ?).
                for (var i = 0; i < statement.Params.Count; i++)
                {
                    var value = statement.Params[i];

                    // Handle JsonElement values from deserialization.
                    if (value is JsonElement jsonElement)
                    {
                        value = ConvertJsonElementToValue(jsonElement);
                    }

                    command.Parameters.AddWithValue($"@p{i}", value ?? DBNull.Value);
                }

                // Replace ? placeholders with named parameters.
                var paramIndex = 0;
                var sql = statement.Sql;
                while (sql.Contains('?'))
                {
                    var pos = sql.IndexOf('?');
                    sql = sql[..pos] + $"@p{paramIndex}" + sql[(pos + 1)..];
                    paramIndex++;
                }

                command.CommandText = sql;
                await command.ExecuteNonQueryAsync();
            }
        }
        finally
        {
            // Re-enable foreign key checks.
            await using var pragmaCommand = _sqlConnection!.CreateCommand();
            pragmaCommand.CommandText = "PRAGMA foreign_keys = ON;";
            await pragmaCommand.ExecuteNonQueryAsync();
        }
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
            _sqlConnection?.Dispose();
        }

        _disposed = true;
    }
}
