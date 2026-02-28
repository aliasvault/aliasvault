package net.aliasvault.app

import android.content.Intent
import android.net.Uri
import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import kotlinx.coroutines.runBlocking
import net.aliasvault.app.UITestHelpers.assertTestIdExists
import net.aliasvault.app.UITestHelpers.dumpHierarchy
import net.aliasvault.app.UITestHelpers.existsByTestId
import net.aliasvault.app.UITestHelpers.findByTestId
import net.aliasvault.app.UITestHelpers.findByText
import net.aliasvault.app.UITestHelpers.hideKeyboard
import net.aliasvault.app.UITestHelpers.longSleep
import net.aliasvault.app.UITestHelpers.saveScreenshot
import net.aliasvault.app.UITestHelpers.scrollToTestId
import net.aliasvault.app.UITestHelpers.scrollToText
import net.aliasvault.app.UITestHelpers.tapTestId
import net.aliasvault.app.UITestHelpers.typeIntoTestId
import net.aliasvault.app.UITestHelpers.waitForTestId
import net.aliasvault.app.UITestHelpers.waitForText
import net.aliasvault.app.UITestHelpers.waitForTextContains
import org.junit.After
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.FixMethodOrder
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TestWatcher
import org.junit.runner.Description
import org.junit.runner.RunWith
import org.junit.runners.MethodSorters
import java.io.File

/**
 * E2E UI Tests for AliasVault Android app.
 *
 * These tests use dynamically created test users via the API, so no pre-configured
 * credentials are needed. Each test creates its own isolated test user to ensure
 * tests can run independently (in isolation or in sequence) with a known state.
 *
 * Prerequisites:
 * - Local API server running at the URL specified in TestConfiguration.apiUrl
 * - Android Emulator with the app installed
 *
 * Note: Tests use UI Automator for interacting with React Native views via accessibility
 * labels (testID in React Native maps to contentDescription in Android)
 */
@RunWith(AndroidJUnit4::class)
@FixMethodOrder(MethodSorters.NAME_ASCENDING)
class AliasVaultUITests {
    private lateinit var device: UiDevice
    private val packageName = "net.aliasvault.app"
    private var currentTestName: String = ""

    companion object {
        private const val TAG = "AliasVaultUITests"
    }

    /**
     * Rule to capture screenshots and UI hierarchy on test failure.
     */
    @get:Rule
    val screenshotOnFailureRule = object : TestWatcher() {
        override fun failed(e: Throwable?, description: Description?) {
            val testName = description?.methodName ?: "unknown"
            Log.e(TAG, "Test '$testName' FAILED - capturing debug info")

            try {
                if (::device.isInitialized) {
                    // Take screenshot
                    val screenshotFile = File("/sdcard/Download/test-failure-$testName.png")
                    val saved = device.saveScreenshot(screenshotFile)
                    Log.e(TAG, "Screenshot saved: $saved to ${screenshotFile.absolutePath}")

                    // Dump UI hierarchy for debugging
                    Log.e(TAG, "=== UI Hierarchy at failure ===")
                    device.dumpHierarchy(System.err)
                    Log.e(TAG, "=== End UI Hierarchy ===")
                }
            } catch (ex: Exception) {
                Log.e(TAG, "Failed to capture debug info: ${ex.message}")
                ex.printStackTrace()
            }
        }

        override fun starting(description: Description?) {
            currentTestName = description?.methodName ?: "unknown"
            Log.i(TAG, "=== Starting test: $currentTestName ===")
            Log.i(TAG, "CI mode: ${TestConfiguration.isCI}")
            Log.i(
                TAG,
                "Timeouts: DEFAULT=${TestConfiguration.DEFAULT_TIMEOUT_MS}ms, " +
                    "EXTENDED=${TestConfiguration.EXTENDED_TIMEOUT_MS}ms",
            )
        }

        override fun finished(description: Description?) {
            Log.i(TAG, "=== Finished test: ${description?.methodName} ===")
        }
    }

    @Before
    fun setUp() {
        device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())

        // Wake up device if sleeping
        device.wakeUp()

        // Disable animations for more reliable tests in CI
        // Note: Requires adb shell settings put global window_animation_scale 0 etc.
        // This is done via the test script, but we log a reminder here
        Log.i(TAG, "Ensure animations are disabled for reliable tests")

        // Note: We don't clear app data here because pm clear kills the instrumentation process.
        // Instead, each test creates its own isolated test user via the API, and loginWithTestUser()
        // handles logging out any existing session before logging in with the new test user.
        // This provides test isolation without crashing the test runner.
    }

    @After
    fun tearDown() {
        // Screenshots on failure are handled by the TestWatcher rule
    }

    // region Test Setup

    /**
     * Creates a new test user for this test.
     * Each test gets its own isolated user to ensure tests can run independently.
     */
    private fun createTestUser(): TestUser = runBlocking {
        // Check if API is available
        val apiAvailable = TestUserRegistration.isApiAvailable()
        assumeTrue("API not available at ${TestConfiguration.apiUrl}. Start the local server first.", apiAvailable)

        // Create a new test user for this specific test
        val user = TestUserRegistration.createTestUser()
        println("[Setup] Created test user: ${user.username}")
        user
    }

    /**
     * Launch the app fresh.
     * Note: For UI tests, the app uses a pre-bundled JS bundle (no Metro needed).
     */
    private fun launchApp() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val intent = context.packageManager.getLaunchIntentForPackage(packageName)
        intent?.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TASK)
        context.startActivity(intent)

        // Wait for app to start and JS bundle to load
        Thread.sleep(5000)

        // Wait for one of the expected screens (check all simultaneously with polling)
        val startTime = System.currentTimeMillis()
        val timeout = TestConfiguration.EXTENDED_TIMEOUT_MS
        while (System.currentTimeMillis() - startTime < timeout) {
            if (device.findByTestId("login-screen") != null ||
                device.findByTestId("unlock-screen") != null ||
                device.findByTestId("items-screen") != null
            ) {
                return
            }
            Thread.sleep(200)
        }
    }

    /**
     * Open a deep link in the app.
     */
    private fun openDeepLink(url: String) {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            setPackage(packageName)
        }
        context.startActivity(intent)
        longSleep()
    }

    /**
     * Pull to refresh gesture.
     */
    private fun pullToRefresh() {
        device.swipe(
            device.displayWidth / 2,
            device.displayHeight / 4,
            device.displayWidth / 2,
            device.displayHeight * 3 / 4,
            10,
        )
        longSleep()
    }

    // endregion

    // region Test 01: Create New Item

    /**
     * Verifies item creation flow: opens add form, fills in details, saves, and verifies
     * the item appears in the list. Creates its own isolated test user.
     */
    @Test
    fun test01CreateItem() {
        val testUser = createTestUser()
        val uniqueName = TestConfiguration.generateUniqueName("E2E Test")
        println("[Test01] Creating item with name: $uniqueName")

        launchApp()
        loginWithTestUser(testUser)

        // Verify items screen is displayed
        println("[Test01] Verifying items screen is displayed")
        device.assertTestIdExists("items-screen", TestConfiguration.EXTENDED_TIMEOUT_MS)

        // Create item
        val itemParams = CreateItemParams(
            name = uniqueName,
            serviceUrl = "https://example.com",
            email = "e2e-test@example.com",
            username = "e2euser",
        )

        assertTrue("Should create item", createItem(itemParams))

        // Verify item exists in list
        assertTrue("Should find item in list", verifyItemExistsInList(uniqueName))

        // Small delay before opening item - list may still be rendering
        Thread.sleep(1000)

        // Open and verify item details
        assertTrue("Should verify item details", openAndVerifyItem(uniqueName, "e2e-test@example.com"))

        println("[Test01] Item creation and verification successful")
    }

    // endregion

    // region Test 02: Offline Mode and Sync

    /**
     * Verifies offline mode and sync recovery:
     * 1. Goes offline by setting API URL to invalid (simulates network failure)
     * 2. Creates a credential while offline (stored locally)
     * 3. Goes back online and triggers sync
     * 4. Verifies the credential persists after sync
     */
    @Test
    fun test02OfflineModeAndSync() {
        val testUser = createTestUser()
        val originalApiUrl = TestConfiguration.apiUrl
        val invalidApiUrl = "http://offline.invalid.localhost:9999"
        val uniqueName = TestConfiguration.generateUniqueName("Offline Test")
        println("[Test02] Creating offline item with name: $uniqueName")

        launchApp()
        loginWithTestUser(testUser)

        // Step 1: Verify online state
        println("[Test02] Step 1: Verify online state")
        device.assertTestIdExists("items-screen", TestConfiguration.EXTENDED_TIMEOUT_MS)

        // Step 2: Enable offline mode via deep link
        println("[Test02] Step 2: Enable offline mode via deep link")
        val encodedInvalidUrl = Uri.encode(invalidApiUrl)
        println("[Test02] Setting API URL to invalid: $invalidApiUrl")
        openDeepLink("aliasvault://open/__debug__/set-api-url/$encodedInvalidUrl")

        unlockVaultIfNeeded(testUser)
        device.assertTestIdExists("items-screen", TestConfiguration.DEFAULT_TIMEOUT_MS)

        // Trigger sync to detect offline state
        pullToRefresh()
        Thread.sleep(3000)

        device.assertTestIdExists("sync-indicator-offline", TestConfiguration.DEFAULT_TIMEOUT_MS)
        println("[Test02] Offline mode enabled successfully")

        // Step 3: Create item while offline
        println("[Test02] Step 3: Create item while offline")
        val offlineItemParams = CreateItemParams(
            name = uniqueName,
            serviceUrl = "https://offline-test.example.com",
            email = "offline-test@example.com",
        )

        assertTrue("Should create item while offline", createItem(offlineItemParams))
        assertTrue("Should find item in list", verifyItemExistsInList(uniqueName))

        println("[Test02] Item created while offline and appears in list")

        // Step 4: Go back online and sync
        println("[Test02] Step 4: Go back online and sync")
        val encodedValidUrl = Uri.encode(originalApiUrl)
        println("[Test02] Restoring API URL to: $originalApiUrl")
        openDeepLink("aliasvault://open/__debug__/set-api-url/$encodedValidUrl")

        unlockVaultIfNeeded(testUser)
        device.assertTestIdExists("items-screen", TestConfiguration.DEFAULT_TIMEOUT_MS)

        Thread.sleep(2000)
        pullToRefresh()
        Thread.sleep(5000)

        // Verify offline indicator is gone
        assertTrue(
            "Offline indicator should be gone after sync",
            !device.existsByTestId("sync-indicator-offline"),
        )

        println("[Test02] Back online and synced successfully")

        // Step 5: Verify item persists after sync
        println("[Test02] Step 5: Verify item persists after sync")
        assertTrue(
            "Should verify item after sync",
            openAndVerifyItem(uniqueName, "offline-test@example.com"),
        )

        println("[Test02] Offline item verified after sync - test passed")
    }

    // endregion

    // region Test 03: RPO Recovery

    /**
     * Verifies RPO (Recovery Point Objective) recovery scenario:
     * When the client detects that its local server revision is higher than the actual server revision
     * (simulating server data loss/rollback), it should upload its vault to recover the server state.
     */
    @Test
    fun test03RPORecovery() = runBlocking {
        val testUser = createTestUser()
        val uniqueName = TestConfiguration.generateUniqueName("RPO Test")
        println("[Test03] Testing RPO recovery with item: $uniqueName")

        launchApp()
        loginWithTestUser(testUser)

        // Step 1: Verify initial state and get server revision
        println("[Test03] Step 1: Verify initial state")
        device.assertTestIdExists("items-screen", TestConfiguration.EXTENDED_TIMEOUT_MS)

        val initialRevisions = TestUserRegistration.getVaultRevisionsByUsername(testUser.username)
        val initialRevision = initialRevisions.second
        println("[Test03] Initial server revision: $initialRevision")

        // Step 2: Create credential while online
        println("[Test03] Step 2: Create credential while online")
        val rpoItemParams = CreateItemParams(
            name = uniqueName,
            serviceUrl = "https://rpo-test.example.com",
            email = "rpo-test@example.com",
        )

        assertTrue("Should create item", createItem(rpoItemParams))
        Thread.sleep(1000) // Wait for sync

        println("[Test03] Credential created and synced to server")

        val afterCreateRevisions = TestUserRegistration.getVaultRevisionsByUsername(testUser.username)
        val revisionAfterCreate = afterCreateRevisions.second
        println("[Test03] Server revision after create: $revisionAfterCreate")

        assertTrue(
            "Server revision should increase after creating credential",
            revisionAfterCreate > initialRevision,
        )

        // Step 3: Simulate server data loss
        println("[Test03] Step 3: Simulate server data loss")
        val deletedCount = TestUserRegistration.deleteVaultRevisionsByUsername(testUser.username, 1)
        println("[Test03] Deleted $deletedCount vault revision(s) from server to simulate data loss")

        val afterDeleteRevisions = TestUserRegistration.getVaultRevisionsByUsername(testUser.username)
        val revisionAfterDelete = afterDeleteRevisions.second
        println("[Test03] Server revision after delete: $revisionAfterDelete")

        assertTrue(
            "Server revision should decrease after deleting vault revision",
            revisionAfterDelete < revisionAfterCreate,
        )

        // Step 4: Trigger sync for RPO recovery
        println("[Test03] Step 4: Trigger sync for RPO recovery")
        println("[Test03] Triggering sync - client should detect RPO scenario and upload vault")
        pullToRefresh()
        Thread.sleep(5000)

        // Step 5: Verify credential persists after RPO recovery
        println("[Test03] Step 5: Verify credential persists after RPO recovery")
        assertTrue(
            "Credential should still exist after RPO recovery",
            openAndVerifyItem(uniqueName, "rpo-test@example.com"),
        )

        // Verify server revision restored
        val finalRevisions = TestUserRegistration.getVaultRevisionsByUsername(testUser.username)
        val finalRevision = finalRevisions.second
        println("[Test03] Final server revision: $finalRevision")

        assertTrue(
            "Server revision should be restored after RPO recovery",
            finalRevision >= revisionAfterCreate,
        )

        println(
            "[Test03] SUCCESS - Revision flow: $initialRevision → $revisionAfterCreate " +
                "(create) → $revisionAfterDelete (rollback) → $finalRevision (recovered)",
        )
    }

    // endregion

    // region Test 04: Forced Logout Recovery

    /**
     * Verifies forced logout recovery mechanism:
     * When a forced logout occurs (e.g., 401 unauthorized due to token invalidation),
     * the client should preserve the encrypted vault locally. On next login with the same
     * credentials, the client should detect the preserved vault and recover by uploading
     * it to the server.
     */
    /*@Test
    fun test04ForcedLogoutRecovery() = runBlocking {
        val testUser = createTestUser()
        val uniqueName = TestConfiguration.generateUniqueName("Forced Logout Test")
        println("[Test04] Testing forced logout recovery with item: $uniqueName")

        launchApp()
        loginWithTestUser(testUser)

        // Step 1: Verify initial state
        println("[Test04] Step 1: Verify initial state")
        device.assertTestIdExists("items-screen", TestConfiguration.EXTENDED_TIMEOUT_MS)

        // Step 2: Create credential while online
        println("[Test04] Step 2: Create credential while online")
        val forcedLogoutItemParams = CreateItemParams(
            name = uniqueName,
            serviceUrl = "https://forced-logout-test.example.com",
            email = "forced-logout-test@example.com",
        )

        assertTrue("Should create item", createItem(forcedLogoutItemParams))
        Thread.sleep(1000) // Wait for sync

        println("[Test04] Credential created and synced to server")

        val beforeLogoutRevisions = TestUserRegistration.getVaultRevisionsByUsername(testUser.username)
        val revisionBeforeLogout = beforeLogoutRevisions.second
        println("[Test04] Server revision before forced logout: $revisionBeforeLogout")

        // Simulate server data loss
        val deletedCount = TestUserRegistration.deleteVaultRevisionsByUsername(testUser.username, 1)
        println("[Test04] Deleted $deletedCount vault revision(s) to simulate server data loss")

        val afterRollbackRevisions = TestUserRegistration.getVaultRevisionsByUsername(testUser.username)
        val revisionAfterRollback = afterRollbackRevisions.second
        println("[Test04] Server revision after rollback: $revisionAfterRollback")

        // Step 3: Block user to trigger forced logout
        println("[Test04] Step 3: Block user to trigger forced logout")
        TestUserRegistration.blockUserByUsername(testUser.username)
        println("[Test04] User blocked")

        // Step 4: Trigger sync to cause forced logout
        println("[Test04] Step 4: Trigger sync to cause forced logout")
        pullToRefresh()

        // Wait for session expired dialog and dismiss it
        val okButton = device.waitForText("OK", TestConfiguration.DEFAULT_TIMEOUT_MS)
        if (okButton != null) {
            println("[Test04] Session expired modal detected, dismissing...")
            okButton.click()
            Thread.sleep(1000)
        } else {
            println("[Test04] No session expired modal detected, continuing...")
        }

        // Step 5: Verify login screen
        println("[Test04] Step 5: Verify login screen after forced logout")
        device.assertTestIdExists("login-screen", TestConfiguration.EXTENDED_TIMEOUT_MS)

        // Verify username is prefilled (orphan vault preservation)
        val usernameInput = device.findByTestId("username-input")
        assertNotNull("Username input should be visible", usernameInput)

        val usernameValue = usernameInput?.text ?: ""
        println("[Test04] Username field value: '$usernameValue'")

        println("[Test04] Forced logout confirmed - on login screen")

        // Unblock user so they can log in again
        TestUserRegistration.unblockUserByUsername(testUser.username)
        println("[Test04] User unblocked")

        // Step 6: Re-login with same credentials
        println("[Test04] Step 6: Re-login with same credentials")
        assertTrue("Should type username", device.typeIntoTestId("username-input", testUser.username))
        assertTrue("Should tap password input", device.tapTestId("password-input"))
        assertTrue("Should type password", device.typeIntoTestId("password-input", testUser.password))

        device.hideKeyboard()
        assertTrue("Should tap login button", device.tapTestId("login-button"))

        // Wait for login to complete
        device.assertTestIdExists("items-screen", TestConfiguration.EXTENDED_TIMEOUT_MS)
        Thread.sleep(5000) // Wait for sync

        println("[Test04] Re-login successful")

        // Step 7: Verify credential still exists
        println("[Test04] Step 7: Verify credential still exists")
        assertTrue(
            "Credential should still exist after forced logout recovery",
            openAndVerifyItem(uniqueName, "forced-logout-test@example.com"),
        )

        // Verify server revision is restored
        val finalRevisions = TestUserRegistration.getVaultRevisionsByUsername(testUser.username)
        val finalRevision = finalRevisions.second
        println("[Test04] Final server revision: $finalRevision")

        assertTrue(
            "Server revision should be restored after forced logout recovery",
            finalRevision >= revisionBeforeLogout,
        )

        println("[Test04] SUCCESS - Forced logout recovery verified!")
        println("[Test04] Revision flow: $revisionBeforeLogout (before) → $revisionAfterRollback (rollback) → $finalRevision (recovered)")
    }*/

    // endregion

    // region Helper Methods

    /**
     * Logs in with test user at the beginning of a test.
     * Always logs out first if already logged in to ensure we're using the correct test user.
     */
    private fun loginWithTestUser(testUser: TestUser) {
        // Wait for app to settle - poll for any expected screen
        val startTime = System.currentTimeMillis()
        val maxWaitTime = 15000L

        while (System.currentTimeMillis() - startTime < maxWaitTime) {
            if (device.findByTestId("unlock-screen") != null ||
                device.findByTestId("login-screen") != null ||
                device.findByTestId("items-screen") != null
            ) {
                break
            }
            Thread.sleep(200)
        }

        // Handle unlock screen - logout to start fresh
        if (device.existsByTestId("unlock-screen")) {
            println("[Helper] Unlock screen detected - logging out to login fresh with test user")

            if (device.tapTestId("logout-button")) {
                // Handle logout confirmation
                val confirmButton = device.waitForText("Logout", TestConfiguration.SHORT_TIMEOUT_MS)
                confirmButton?.click()
            }

            device.waitForTestId("login-screen", TestConfiguration.DEFAULT_TIMEOUT_MS)
        }

        // Check if we're on login screen
        if (device.existsByTestId("login-screen")) {
            performLogin(testUser)
            return
        }

        // Check if already on items screen
        if (device.existsByTestId("items-screen")) {
            println("[Helper] Already on items screen, assuming correct user is logged in")
            return
        }

        println("[Helper] Unknown app state after waiting, test may fail")
    }

    /**
     * Unlocks the vault if the unlock screen is displayed.
     */
    private fun unlockVaultIfNeeded(testUser: TestUser) {
        val unlockScreen = device.waitForTestId("unlock-screen", TestConfiguration.SHORT_TIMEOUT_MS)
        if (unlockScreen == null) {
            if (device.existsByTestId("items-screen")) {
                println("[Helper] Already on items screen, no unlock needed")
            } else {
                println("[Helper] Not on unlock or items screen, proceeding anyway")
            }
            return
        }

        println("[Helper] Unlock screen detected - entering password to unlock")

        device.tapTestId("unlock-password-input")
        device.typeIntoTestId("unlock-password-input", testUser.password)
        device.hideKeyboard()
        device.tapTestId("unlock-button")

        device.waitForTestId("items-screen", TestConfiguration.EXTENDED_TIMEOUT_MS)
    }

    /**
     * Performs login with the given test user credentials.
     */
    private fun performLogin(testUser: TestUser) {
        // Check if API URL is already configured to localhost
        val serverUrlLink = device.findByTestId("server-url-link")
        var needsApiConfig = true

        if (serverUrlLink != null) {
            val urlText = serverUrlLink.text ?: ""
            if (urlText.contains("localhost")) {
                println("[Helper] API URL already configured to localhost, skipping API configuration")
                needsApiConfig = false
            } else {
                println("[Helper] API URL shows '$urlText', need to configure to localhost")
            }
        }

        if (needsApiConfig) {
            if (device.tapTestId("server-url-link-button")) {
                if (device.waitForTestId("api-option-custom", TestConfiguration.DEFAULT_TIMEOUT_MS) != null) {
                    device.tapTestId("api-option-custom")

                    if (device.waitForTestId("custom-api-url-input") != null) {
                        device.tapTestId("custom-api-url-input")
                        device.typeIntoTestId("custom-api-url-input", TestConfiguration.apiUrl)
                        println("[Helper] Configured API URL: ${TestConfiguration.apiUrl}")
                    }

                    device.hideKeyboard()
                    device.tapTestId("back-button")
                }
            }
        }

        // Wait for login screen
        device.waitForTestId("login-screen")

        // Enter credentials
        device.typeIntoTestId("username-input", testUser.username)
        device.tapTestId("password-input")
        device.typeIntoTestId("password-input", testUser.password)
        device.hideKeyboard()
        device.tapTestId("login-button")

        // Wait for items screen
        device.waitForTestId("items-screen", TestConfiguration.EXTENDED_TIMEOUT_MS)
    }

    /**
     * Parameters for creating a new item.
     */
    data class CreateItemParams(
        val name: String,
        val serviceUrl: String = "https://example.com",
        val email: String = "test@example.com",
        val username: String? = null,
    )

    /**
     * Creates a new item with the given parameters.
     */
    private fun createItem(params: CreateItemParams): Boolean {
        println("[Helper] Creating item: ${params.name}")

        // Log current screen state for debugging
        println("[Helper] Current screen state before add:")
        println("[Helper]   - items-screen exists: ${device.existsByTestId("items-screen")}")
        println("[Helper]   - add-item-button exists: ${device.existsByTestId("add-item-button")}")

        // Wait for items screen to be fully loaded before attempting to add
        if (device.waitForTestId("items-screen", TestConfiguration.DEFAULT_TIMEOUT_MS) == null) {
            println("[Helper] Items screen not ready, waiting longer...")
            Thread.sleep(2000)
        }

        // Tap add button
        if (!device.tapTestId("add-item-button")) {
            println("[Helper] Failed to tap add button - button may not be visible")
            // Try scrolling to top and retry
            device.swipe(
                device.displayWidth / 2,
                device.displayHeight / 4,
                device.displayWidth / 2,
                device.displayHeight * 3 / 4,
                10,
            )
            Thread.sleep(500)
            if (!device.tapTestId("add-item-button")) {
                println("[Helper] Failed to tap add button after scroll retry")
                return false
            }
        }

        println("[Helper] Tapped add button, waiting for add-edit-screen...")
        if (device.waitForTestId("add-edit-screen", TestConfiguration.DEFAULT_TIMEOUT_MS) == null) {
            println("[Helper] Add/edit screen did not appear within timeout")
            println("[Helper]   - add-edit-screen exists: ${device.existsByTestId("add-edit-screen")}")
            println("[Helper]   - items-screen exists: ${device.existsByTestId("items-screen")}")
            return false
        }
        println("[Helper] Add/edit screen appeared")

        // Fill item name
        println("[Helper] Filling item name: ${params.name}")
        device.scrollToTestId("item-name-input")
        device.tapTestId("item-name-input")
        if (!device.typeIntoTestId("item-name-input", params.name)) {
            println("[Helper] Failed to type item name")
            return false
        }

        // Fill service URL (multi-value field, first input has index 0)
        println("[Helper] Filling service URL: ${params.serviceUrl}")
        device.scrollToTestId("service-url-input-0")
        device.tapTestId("service-url-input-0")
        device.typeIntoTestId("service-url-input-0", params.serviceUrl)

        // Add email - click button and wait for field to appear
        println("[Helper] Adding email field...")
        device.scrollToTestId("add-email-button")
        if (!device.tapTestId("add-email-button")) {
            println("[Helper] Failed to tap add-email-button")
            return false
        }
        Thread.sleep(500) // Wait for field animation

        println("[Helper] Filling email: ${params.email}")
        device.scrollToTestId("login-email-input")
        device.tapTestId("login-email-input")
        device.typeIntoTestId("login-email-input", params.email)

        // Optionally add username
        if (params.username != null) {
            println("[Helper] Filling username: ${params.username}")
            device.scrollToTestId("login-username-input")
            if (device.existsByTestId("login-username-input")) {
                device.tapTestId("login-username-input")
                device.typeIntoTestId("login-username-input", params.username)
            }
        }

        device.hideKeyboard()
        Thread.sleep(500) // Wait for keyboard to fully hide

        // Save item - wait for button to be available then tap
        println("[Helper] Looking for save button...")
        if (device.waitForTestId("save-button", TestConfiguration.DEFAULT_TIMEOUT_MS) == null) {
            println("[Helper] Save button not found within timeout")
            return false
        }
        println("[Helper] Tapping save button...")
        if (!device.tapTestId("save-button")) {
            println("[Helper] Failed to tap save button")
            return false
        }

        println("[Helper] Waiting for item detail screen...")
        if (device.waitForText("Login credentials", TestConfiguration.DEFAULT_TIMEOUT_MS) == null) {
            println("[Helper] Item detail screen did not appear after save")
            println("[Helper]   - Current UI may show error or different screen")
            return false
        }
        println("[Helper] Item detail screen appeared")

        // Return to items list
        Thread.sleep(1000)
        println("[Helper] Tapping back button to return to items list...")
        device.tapTestId("back-button")

        if (device.waitForTestId("items-screen", TestConfiguration.DEFAULT_TIMEOUT_MS) == null) {
            println("[Helper] Did not return to items screen after back button")
            return false
        }

        // Wait for list to populate
        Thread.sleep(2000)

        println("[Helper] Item '${params.name}' created successfully")
        return true
    }

    /**
     * Verifies that an item with the given name exists in the items list.
     */
    private fun verifyItemExistsInList(name: String): Boolean {
        val itemFound = device.scrollToText(name) != null ||
            device.waitForText(name, TestConfiguration.DEFAULT_TIMEOUT_MS) != null

        if (!itemFound) {
            println("[Helper] Item '$name' not found in list")
            return false
        }

        println("[Helper] Item '$name' found in list")
        return true
    }

    /**
     * Opens an item from the list and verifies its details.
     */
    private fun openAndVerifyItem(name: String, expectedEmail: String? = null): Boolean {
        println("[Helper] Opening item '$name' to verify details")

        val itemCard = device.scrollToText(name) ?: device.findByText(name)

        if (itemCard == null) {
            println("[Helper] Item '$name' not found in list")
            return false
        }

        println("[Helper] Found item card, clicking...")
        itemCard.click()

        // Wait for detail screen - use longer timeout for screen transition
        Thread.sleep(500) // Small delay for click to register
        println("[Helper] Waiting for detail screen (Login credentials text)...")
        if (device.waitForText("Login credentials", TestConfiguration.DEFAULT_TIMEOUT_MS) == null) {
            println("[Helper] Item detail screen did not appear")
            println("[Helper]   - items-screen visible: ${device.existsByTestId("items-screen")}")
            println("[Helper]   - add-edit-screen visible: ${device.existsByTestId("add-edit-screen")}")
            return false
        }
        println("[Helper] Detail screen appeared")

        if (expectedEmail != null) {
            println("[Helper] Looking for email '$expectedEmail' on detail screen...")
            // Use DEFAULT_TIMEOUT_MS instead of SHORT_TIMEOUT_MS for email verification
            // In headless CI mode, content rendering can be slow
            if (device.waitForTextContains(expectedEmail, TestConfiguration.DEFAULT_TIMEOUT_MS) == null) {
                println("[Helper] Expected email '$expectedEmail' not found within timeout")
                return false
            }
            println("[Helper] Email found on detail screen")
        }

        println("[Helper] Item '$name' verified successfully")
        return true
    }

    // endregion
}
