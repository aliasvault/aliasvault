package net.aliasvault.app.nativevaultmanager

import junit.framework.TestCase.assertEquals
import net.aliasvault.app.vaultstore.VaultStore
import net.aliasvault.app.vaultstore.keystoreprovider.TestKeystoreProvider
import net.aliasvault.app.vaultstore.storageprovider.TestStorageProvider
import org.junit.Before
import org.junit.Ignore
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

@Ignore("New SQLite requery library is not supported in Robolectric test runs, needs to be refactored later")
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], manifest = Config.NONE)
class VaultStoreTest {
    private lateinit var vaultStore: VaultStore
    private val testEncryptionKeyBase64 = "/9So3C83JLDIfjsF0VQOc4rz1uAFtIseW7yrUuztAD0=" // 32 bytes for AES-256

    @Before
    fun setup() {
        // Store test data
        val encryptedDb = loadTestDatabase()

        // Initialize the VaultStore instance with a mock file provider that
        // is only used for testing purposes
        vaultStore = VaultStore(TestStorageProvider(), TestKeystoreProvider())
        vaultStore.storeEncryptionKey(testEncryptionKeyBase64)
        vaultStore.storeEncryptedDatabase(encryptedDb)

        val metadata = """
        {
            "publicEmailDomains": ["spamok.com", "spamok.nl"],
            "privateEmailDomains": ["aliasvault.net", "main.aliasvault.net", "hidden.aliasvault.net"],
            "hiddenPrivateEmailDomains": ["hidden.aliasvault.net"],
            "vaultRevisionNumber": 1
        }
        """
        vaultStore.storeMetadata(metadata)
        vaultStore.unlockVault()
    }

    @Test
    fun testDatabaseInitialization() {
        assertTrue(vaultStore.isVaultUnlocked())
    }

    @Test
    fun testGetAllCredentials() {
        val credentials = vaultStore.getAllCredentials()

        // Verify we got some credentials back
        assertFalse(credentials.isEmpty(), "Should have retrieved some credentials")

        // Verify the structure of the first credential
        if (credentials.isNotEmpty()) {
            val firstCredential = credentials.first()
            assertNotNull(firstCredential.id, "Credential should have an ID")
            assertNotNull(firstCredential.service, "Credential should have a service")
            assertNotNull(firstCredential.password, "Credential should have a password")
            assertNotNull(firstCredential.username, "Credential should have a username")
            assertNotNull(firstCredential.createdAt, "Credential should have a creation date")
            assertNotNull(firstCredential.updatedAt, "Credential should have an update date")
        }
    }

    @Test
    fun testGetGmailCredentialDetails() {
        // Get all credentials
        val credentials = vaultStore.getAllCredentials()

        // Find the Gmail credential
        val gmailCredential = credentials.find { it.service.name == "Gmail Test Account" }
        assertNotNull(gmailCredential, "Gmail Test Account credential should exist")

        // Verify all expected properties
        assertEquals("Gmail Test Account", gmailCredential.service.name)
        assertEquals("https://google.com", gmailCredential.service.url)
        assertEquals("test.user@gmail.com", gmailCredential.username)
        assertEquals("Test", gmailCredential.alias?.firstName)
        assertEquals("User", gmailCredential.alias?.lastName)
        assertEquals("Test Gmail account for unit testing", gmailCredential.notes)

        // Verify logo exists and has sufficient size
        val logo = gmailCredential.service.logo

        assertNotNull(logo, "Service logo should not be nil")
        assertTrue(logo.size > 1024, "Logo data should exceed 1KB in size")
    }

    @Test
    fun testDatabaseWriteOperation() {
        // Create a test setting
        val testKey = "test_setting_key"
        val testValue = "test_setting_value"

        // Begin transaction
        vaultStore.beginTransaction()
        try {
            // Insert the setting using raw SQL with parameters
            val insertSql = "INSERT INTO Settings (Key, Value, CreatedAt, UpdatedAt, IsDeleted) VALUES (?, ?, ?, ?, ?)"
            val insertResult = vaultStore.executeUpdate(
                insertSql,
                arrayOf(testKey, testValue, "2025-01-01 00:00:00", "2025-01-01 00:00:00", 0),
            )
            assertTrue(insertResult > 0, "Setting insertion should succeed")

            // Verify the setting was inserted by querying it
            val querySql = "SELECT Value FROM Settings WHERE Key = ?"
            val results = vaultStore.executeQuery(querySql, arrayOf(testKey))

            assertTrue(results.isNotEmpty(), "Should get a result (amount of updated rows)")

            // If everything succeeded, commit the transaction
            vaultStore.commitTransaction()

            // Then, try to re-load the database and ensure the __EFMigrationsHistory table still exists.
            // This asserts that the database commit results in a properly exported and encrypted database file.
            vaultStore.clearCache()
            vaultStore.storeEncryptionKey(testEncryptionKeyBase64)
            vaultStore.unlockVault()

            // Do a query
            val querySql2 = "SELECT MigrationId FROM __EFMigrationsHistory"
            val results2 = vaultStore.executeQuery(querySql2, arrayOf<Any?>())

            assertTrue(
                results2.isNotEmpty(),
                "Should get a result (migration history table contents)",
            )
        } catch (e: Exception) {
            // If anything fails, rollback the transaction
            throw e
        }
    }

    private fun loadTestDatabase(): String {
        // Load the test database file from resources
        val inputStream = javaClass.classLoader?.getResourceAsStream("test-encrypted-vault.txt")
            ?: throw IllegalStateException("Test database file not found")

        return inputStream.bufferedReader().use { it.readText() }
    }
}
