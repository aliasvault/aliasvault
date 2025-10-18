//-----------------------------------------------------------------------
// <copyright file="DbService.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Services.Database;

using System.Data;
using System.Net.Http.Json;
using AliasClientDb;
using AliasVault.Client.Services;
using AliasVault.Client.Services.Auth;
using AliasVault.Client.Services.JsInterop.Models;
using AliasVault.Shared.Models.Enums;
using AliasVault.Shared.Models.WebApi.Vault;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

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
    private readonly HttpClient _httpClient;
    private readonly DbServiceState _state = new();
    private readonly Config _config;
    private readonly ILogger<DbService> _logger;
    private readonly GlobalNotificationService _globalNotificationService;
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
    /// <param name="httpClient">HttpClient.</param>
    /// <param name="config">Config instance.</param>
    /// <param name="globalNotificationService">Global notification service.</param>
    /// <param name="logger">ILogger instance.</param>
    public DbService(AuthService authService, JsInteropService jsInteropService, HttpClient httpClient, Config config, GlobalNotificationService globalNotificationService, ILogger<DbService> logger)
    {
        _authService = authService;
        _jsInteropService = jsInteropService;
        _httpClient = httpClient;
        _config = config;
        _globalNotificationService = globalNotificationService;
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
    /// Merges two or more databases into one.
    /// </summary>
    /// <returns>Bool which indicates if merging was successful.</returns>
    public async Task<bool> MergeDatabasesAsync()
    {
        try
        {
            var vaultsToMerge = await _httpClient.GetFromJsonAsync<VaultMergeResponse>($"v1/Vault/merge?currentRevisionNumber={_vaultRevisionNumber}");
            if (vaultsToMerge == null || vaultsToMerge.Vaults.Count == 0)
            {
                // No vaults to merge found, set error state.
                _state.UpdateState(DbServiceState.DatabaseStatus.MergeFailed, "No vaults to merge found.");
                return false;
            }

            var sqlConnections = new List<SqliteConnection>();
            _logger.LogInformation("Merging databases...");

            // Decrypt and instantiate each vault as a separate in-memory SQLite database.
            foreach (var vault in vaultsToMerge.Vaults)
            {
                // Store username of the loaded vault in memory to send to server as sanity check when updating the vault later.
                _authService.StoreUsername(vault.Username);

                var decryptedBase64String = await _jsInteropService.SymmetricDecrypt(vault.Blob, _authService.GetEncryptionKeyAsBase64Async());

                _logger.LogInformation("Decrypted vault {VaultUpdatedAt}.", vault.UpdatedAt);
                var connection = new SqliteConnection("Data Source=:memory:");
                await connection.OpenAsync();
                await ImportDbContextFromBase64Async(decryptedBase64String, connection);
                sqlConnections.Add(connection);
            }

            // Get all table names from the current base database.
            var tables = await DbMergeUtility.GetTableNames(_sqlConnection!);

            // Disable foreign key checks on the base connection.
            await using (var command = _sqlConnection!.CreateCommand())
            {
                command.CommandText = "PRAGMA foreign_keys = OFF;";
                await command.ExecuteNonQueryAsync();
            }

            // Merge every remote database into the current database.
            foreach (var connection in sqlConnections)
            {
                foreach (var table in tables)
                {
                    _logger.LogInformation("Merging table {Table}.", table);
                    await DbMergeUtility.MergeTable(_sqlConnection, connection, table, _logger);
                }
            }

            // Re-enable foreign key checks and verify integrity.
            await using (var command = _sqlConnection.CreateCommand())
            {
                command.CommandText = "PRAGMA foreign_keys = ON;";
                await command.ExecuteNonQueryAsync();

                // Verify foreign key integrity.
                command.CommandText = "PRAGMA foreign_key_check;";
                await using var reader = await command.ExecuteReaderAsync();
                if (await reader.ReadAsync())
                {
                    // Foreign key violation detected.
                    _state.UpdateState(DbServiceState.DatabaseStatus.MergeFailed, "Foreign key violation detected after merge.");
                    return false;
                }
            }

            // Update the db context with the new merged database.
            _dbContext = new AliasClientDbContext(_sqlConnection, log => _logger.LogDebug("{Message}", log));

            // Clean up other connections.
            foreach (var connection in sqlConnections)
            {
                await connection.CloseAsync();
                await connection.DisposeAsync();
            }

            // Update the current vault revision number to the highest revision number in the merged database(s).
            // This is important so the server knows that the local client has successfully merged the databases
            // and should overwrite the existing database on the server with the new merged database.
            var newRevisionNumber = vaultsToMerge.Vaults.Max(v => v.CurrentRevisionNumber);
            StoreVaultRevisionNumber(newRevisionNumber);

            _isSuccessfullyInitialized = true;
            await _settingsService.InitializeAsync(this);
            _state.UpdateState(DbServiceState.DatabaseStatus.Ready);
            _logger.LogInformation("Databases merged successfully.");

            // Save the newly merged database to the server.
            return await SaveDatabaseAsync();
        }
        catch (Exception ex)
        {
            _globalNotificationService.AddErrorMessage(
                "Unable to save changes: Your vault has been updated elsewhere. " +
                "The automatic merge was unsuccessful, possibly due to a password change or vault upgrade. " +
                "Please log out and log back in to retrieve the latest version of your vault.");
            _logger.LogError(ex, "Error merging databases.");
            _state.UpdateState(DbServiceState.DatabaseStatus.Ready);
            return false;
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

        // Get all available vault versions to get the revision number of the current version.
        var allVersions = await _jsInteropService.GetAllVaultVersionsAsync();
        var currentVersionRevision = allVersions.FirstOrDefault(v => v.Version == currentVersion);

        return currentVersionRevision ?? new SqlVaultVersion
        {
            Revision = 0,
            Version = _UNKNOWN_VERSION,
            Description = _UNKNOWN_VERSION,
            ReleaseVersion = _UNKNOWN_VERSION,
            CompatibleUpToVersion = _UNKNOWN_VERSION,
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
        var credentialsCount = await _dbContext.Credentials.Where(x => !x.IsDeleted).CountAsync();
        var emailAddresses = await GetEmailClaimListAsync();
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
            PublicEmailDomainList = [],
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
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
    /// Get a list of private email addresses that are used in aliases by this vault.
    /// </summary>
    /// <returns>List of email addresses.</returns>
    public async Task<List<string>> GetEmailClaimListAsync()
    {
        // Send list of email addresses that are used in aliases by this vault, so they can be
        // claimed on the server.
        var emailAddresses = await _dbContext.Aliases
            .Where(a => a.Email != null)
            .Where(a => !a.IsDeleted)
            .Select(a => a.Email)
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
                if (response.Status == VaultStatus.MergeRequired)
                {
                    _state.UpdateState(DbServiceState.DatabaseStatus.MergeRequired);
                    return false;
                }

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

                // Check if any soft-deleted records exist that are older than 7 days. If so, permanently delete them.
                await VaultCleanupSoftDeletedRecords();

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
                // If the server responds with a merge required status, we need to merge the local database
                // with the one on the server before we can continue.
                if (vaultUpdateResponse.Status == VaultStatus.MergeRequired)
                {
                    _state.UpdateState(DbServiceState.DatabaseStatus.MergeRequired);
                    return await MergeDatabasesAsync();
                }
                else if (vaultUpdateResponse.Status == VaultStatus.Outdated)
                {
                    // If the server responds with "outdated", it means we need to re-fetch the latest vault.
                    // Because of how the WASM client works now, it mutates the current database in memory so we need to
                    // merge the newly fetched database with the local database. For this we still need the
                    // merge databases logic. So for outdated responses, we still call the MergeDatabasesAsync() method.
                    // TODO: when changing datamodel and improving offline mode and batched mutations, update this logic and flow as well.
                    _state.UpdateState(DbServiceState.DatabaseStatus.MergeRequired);
                    return await MergeDatabasesAsync();
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

        encryptionKey = new EncryptionKey
        {
            PublicKey = keyPair.PublicKey,
            PrivateKey = keyPair.PrivateKey,
            IsPrimary = true,
            CreatedAt = DateTime.Now,
            UpdatedAt = DateTime.Now,
        };
        _dbContext.EncryptionKeys.Add(encryptionKey);
        return encryptionKey;
    }

    /// <summary>
    /// Check if any soft-deleted records exist that are older than 7 days. If so, permanently delete them.
    /// </summary>
    /// <returns>Task.</returns>
    private async Task VaultCleanupSoftDeletedRecords()
    {
        var cutoffDate = DateTime.UtcNow.AddDays(-7);
        var deleteCount = 0;

        // Hard delete soft-deleted Credentials older than 7 days
        deleteCount += await _dbContext.Credentials
            .Where(c => c.IsDeleted && c.UpdatedAt <= cutoffDate)
            .ExecuteDeleteAsync();

        // Hard delete soft-deleted Passkeys older than 7 days
        deleteCount += await _dbContext.Passkeys
            .Where(p => p.IsDeleted && p.UpdatedAt <= cutoffDate)
            .ExecuteDeleteAsync();

        // Hard delete soft-deleted Attachments older than 7 days
        deleteCount += await _dbContext.Attachments
            .Where(a => a.IsDeleted && a.UpdatedAt <= cutoffDate)
            .ExecuteDeleteAsync();

        if (deleteCount > 0)
        {
            var success = await SaveDatabaseAsync();
            if (!success)
            {
                throw new DataException("Error saving database to server after record deletion.");
            }
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
            _sqlConnection?.Dispose();
        }

        _disposed = true;
    }
}
