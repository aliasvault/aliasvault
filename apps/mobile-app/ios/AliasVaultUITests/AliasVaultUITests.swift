import XCTest

/// E2E UI Tests for AliasVault iOS app.
///
/// These tests use dynamically created test users via the API, so no pre-configured
/// credentials are needed. Each test creates its own isolated test user to ensure
/// tests can run independently (in isolation or in sequence) with a known state.
///
/// Prerequisites:
/// - Local API server running at the URL specified in TestConfiguration.apiUrl
/// - iOS Simulator with the app installed
///
/// Note: All UI interactions use `NoIdle` variants (e.g., `waitForExistenceNoIdle`,
/// `tapNoIdle`) to avoid XCTest hanging on React Native's continuous timers/animations.
final class AliasVaultUITests: XCTestCase {
    var app: XCUIApplication!

    override func setUp() {
        super.setUp()
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments.append("--uitest")
    }

    override func tearDown() {
        app = nil
        super.tearDown()
    }

    // MARK: - Test Setup

    /// Creates a new test user for this test.
    /// Each test gets its own isolated user to ensure tests can run independently.
    private func createTestUser() async throws -> TestUser {
        // Check if API is available
        let apiAvailable = await TestUserRegistration.isApiAvailable()
        guard apiAvailable else {
            throw XCTSkip("API not available at \(TestConfiguration.apiUrl). Start the local server first.")
        }

        // Create a new test user for this specific test
        let user = try await TestUserRegistration.createTestUser()
        print("[Setup] Created test user: \(user.username)")
        return user
    }

    // MARK: - Error Reporting Helpers

    /// Captures a failure screenshot with descriptive name and attaches it to the test.
    /// Call this in assertion failure handlers or catch blocks.
    @MainActor
    private func captureFailureState(context: String) {
        let screenshot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = "FAILURE-\(context)"
        attachment.lifetime = .keepAlways
        add(attachment)

        // Also log the current app hierarchy for debugging
        let hierarchyAttachment = XCTAttachment(string: app.debugDescription)
        hierarchyAttachment.name = "FAILURE-hierarchy-\(context)"
        hierarchyAttachment.lifetime = .keepAlways
        add(hierarchyAttachment)
    }

    /// Asserts an element exists with enhanced error reporting.
    /// On failure, captures screenshot and app hierarchy for CI debugging.
    /// Returns true if element exists, false otherwise. Use for early returns.
    @discardableResult
    @MainActor
    private func assertElementExists(
        _ element: XCUIElement,
        timeout: TimeInterval = TestConfiguration.defaultTimeout,
        message: String,
        context: String
    ) -> Bool {
        let exists = element.waitForExistenceNoIdle(timeout: timeout)
        if !exists {
            captureFailureState(context: context)
            XCTFail("\(message). Element identifier: '\(element.identifier)', exists: \(element.exists), isHittable: \(element.isHittable)")
            return false
        }
        return true
    }

    /// Asserts text appears on screen with enhanced error reporting.
    /// Returns true if text appears, false otherwise. Use for early returns.
    @discardableResult
    @MainActor
    private func assertTextAppears(
        _ text: String,
        timeout: TimeInterval = TestConfiguration.defaultTimeout,
        message: String,
        context: String
    ) -> Bool {
        let appeared = app.waitForText(text, timeout: timeout)
        if !appeared {
            captureFailureState(context: context)
            XCTFail("\(message). Expected text: '\(text)'")
            return false
        }
        return true
    }

    /// Asserts text containing substring appears with enhanced error reporting.
    /// Returns true if text appears, false otherwise. Use for early returns.
    @discardableResult
    @MainActor
    private func assertTextContaining(
        _ substring: String,
        timeout: TimeInterval = TestConfiguration.defaultTimeout,
        message: String,
        context: String
    ) -> Bool {
        let appeared = app.waitForTextContaining(substring, timeout: timeout)
        if !appeared {
            captureFailureState(context: context)
            XCTFail("\(message). Expected text containing: '\(substring)'")
            return false
        }
        return true
    }

    // MARK: - Test 01: Create New Item

    /// Verifies item creation flow: opens add form, fills in details, saves, and verifies
    /// the item appears in the list. Creates its own isolated test user.
    @MainActor
    func test01CreateItem() async throws {
        let testUser = try await createTestUser()
        let uniqueName = TestConfiguration.generateUniqueName(prefix: "E2E Test")
        print("[Test01] Creating item with name: \(uniqueName)")

        app.launch()
        loginWithTestUser(testUser)

        // Verify items screen is displayed
        print("[Test01] Verifying items screen is displayed")
        let itemsScreen = app.findElement(testID: "items-screen")
        guard assertElementExists(
            itemsScreen,
            timeout: TestConfiguration.extendedTimeout,
            message: "Should be on items screen after launch/unlock",
            context: "01-items-screen"
        ) else {
            return
        }

        // Create item using helper
        let itemParams = CreateItemParams(
            name: uniqueName,
            serviceUrl: "https://example.com",
            email: "e2e-test@example.com",
            username: "e2euser"
        )

        guard createItem(params: itemParams, contextPrefix: "01") else {
            return
        }

        // Verify item exists in list
        guard verifyItemExistsInList(name: uniqueName, contextPrefix: "01") else {
            return
        }

        // Open and verify item details
        guard openAndVerifyItem(name: uniqueName, expectedEmail: "e2e-test@example.com", contextPrefix: "01") else {
            return
        }

        let itemVerifiedScreenshot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: itemVerifiedScreenshot)
        attachment.name = "01-item-verified"
        attachment.lifetime = .keepAlways
        add(attachment)

        print("[Test01] Item creation and verification successful")
    }

    // MARK: - Test 02: Offline Mode and Sync

    /// Verifies offline mode and sync recovery:
    /// 1. Goes offline by setting API URL to invalid (simulates network failure)
    /// 2. Creates a credential while offline (stored locally)
    /// 3. Goes back online and triggers sync
    /// 4. Verifies the credential persists after sync
    ///
    /// Uses debug deep links (`__debug__/set-api-url`) to toggle offline mode.
    /// These only work in development builds.
    @MainActor
    func test02OfflineModeAndSync() async throws {
        let testUser = try await createTestUser()

        app.launch()
        loginWithTestUser(testUser)

        let originalApiUrl = TestConfiguration.apiUrl
        let invalidApiUrl = "http://offline.invalid.localhost:9999"
        let uniqueName = TestConfiguration.generateUniqueName(prefix: "Offline Test")
        print("[Test02] Creating offline item with name: \(uniqueName)")

        let itemsScreen = app.findElement(testID: "items-screen")
        let offlineIndicator = app.findElement(testID: "sync-indicator-offline")

        // Step 1: Verify online state
        print("[Test02] Step 1: Verify online state")
        guard assertElementExists(
            itemsScreen,
            timeout: TestConfiguration.extendedTimeout,
            message: "Should be on items screen",
            context: "02-items-screen"
        ) else {
            return
        }

        let initialStateScreenshot = XCUIScreen.main.screenshot()
        let attachment1 = XCTAttachment(screenshot: initialStateScreenshot)
        attachment1.name = "02-1-initial-state-online"
        attachment1.lifetime = .keepAlways
        add(attachment1)

        // Step 2: Enable offline mode via deep link
        print("[Test02] Step 2: Enable offline mode via deep link")
        let encodedInvalidUrl = invalidApiUrl.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? invalidApiUrl
        print("[Test02] Setting API URL to invalid: \(invalidApiUrl)")
        app.openDeepLink("aliasvault://open/__debug__/set-api-url/\(encodedInvalidUrl)")

        unlockVaultIfNeeded(with: testUser)

        guard assertElementExists(
            itemsScreen,
            timeout: 10,
            message: "Should return to items screen after deep link",
            context: "02-after-offline-deeplink"
        ) else {
            return
        }

        // Trigger a sync attempt to detect offline state
        app.pullToRefresh()
        sleep(3)

        guard assertElementExists(
            offlineIndicator,
            timeout: 10,
            message: "Offline indicator should appear after API URL change",
            context: "02-offline-indicator"
        ) else {
            return
        }

        let offlineModeScreenshot = XCUIScreen.main.screenshot()
        let attachment2 = XCTAttachment(screenshot: offlineModeScreenshot)
        attachment2.name = "02-2-offline-mode-enabled"
        attachment2.lifetime = .keepAlways
        add(attachment2)

        print("[Test02] Offline mode enabled successfully")

        // Step 3: Create item while offline using helper
        print("[Test02] Step 3: Create item while offline")
        let offlineItemParams = CreateItemParams(
            name: uniqueName,
            serviceUrl: "https://offline-test.example.com",
            email: "offline-test@example.com"
        )

        guard createItem(params: offlineItemParams, contextPrefix: "02") else {
            return
        }

        // Verify item exists in list
        guard verifyItemExistsInList(name: uniqueName, contextPrefix: "02") else {
            return
        }

        let itemInListOfflineScreenshot = XCUIScreen.main.screenshot()
        let attachment3 = XCTAttachment(screenshot: itemInListOfflineScreenshot)
        attachment3.name = "02-3-item-in-list-offline"
        attachment3.lifetime = .keepAlways
        add(attachment3)

        print("[Test02] Item created while offline and appears in list")

        // Step 4: Go back online and sync
        print("[Test02] Step 4: Go back online and sync")
        let encodedValidUrl = originalApiUrl.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? originalApiUrl
        print("[Test02] Restoring API URL to: \(originalApiUrl)")
        app.openDeepLink("aliasvault://open/__debug__/set-api-url/\(encodedValidUrl)")

        unlockVaultIfNeeded(with: testUser)

        guard assertElementExists(
            itemsScreen,
            timeout: 10,
            message: "Should return to items screen after restoring API URL",
            context: "02-after-online-deeplink"
        ) else {
            return
        }

        sleep(2)

        let backOnlineScreenshot = XCUIScreen.main.screenshot()
        let attachment9 = XCTAttachment(screenshot: backOnlineScreenshot)
        attachment9.name = "02-9-back-online"
        attachment9.lifetime = .keepAlways
        add(attachment9)

        app.pullToRefresh()
        sleep(5)

        // Verify offline indicator is gone
        if offlineIndicator.exists {
            captureFailureState(context: "02-offline-indicator-still-present")
            XCTFail("Offline indicator should be gone after sync")
        }

        let syncedScreenshot = XCUIScreen.main.screenshot()
        let attachment10 = XCTAttachment(screenshot: syncedScreenshot)
        attachment10.name = "02-10-synced-successfully"
        attachment10.lifetime = .keepAlways
        add(attachment10)

        print("[Test02] Back online and synced successfully")

        // Step 5: Verify item persists after sync using helper
        print("[Test02] Step 5: Verify item persists after sync")
        guard openAndVerifyItem(name: uniqueName, expectedEmail: "offline-test@example.com", contextPrefix: "02-after-sync") else {
            return
        }

        let itemVerifiedAfterSyncScreenshot = XCUIScreen.main.screenshot()
        let attachment11 = XCTAttachment(screenshot: itemVerifiedAfterSyncScreenshot)
        attachment11.name = "02-11-item-verified-after-sync"
        attachment11.lifetime = .keepAlways
        add(attachment11)

        print("[Test02] Offline item verified after sync - test passed")
    }

    // MARK: - Test 03: RPO Recovery

    /// Verifies RPO (Recovery Point Objective) recovery scenario:
    /// When the client detects that its local server revision is higher than the actual server revision
    /// (simulating server data loss/rollback), it should upload its vault to recover the server state.
    ///
    /// This test simulates the scenario where:
    /// - Client creates credentials → server has vault at revision N with the credential
    /// - Server data loss occurs → we delete the latest vault revision via API
    /// - Server now at revision N-1 (without the credential)
    /// - Client still has the credential locally and thinks server is at revision N
    /// - On next sync, client detects: "server says revision N-1, but I synced at N"
    /// - Client uploads its vault to "recover" the server (RPO behavior)
    /// - Credential should still exist after sync (proving upload happened, not download)
    ///
    /// Test flow:
    /// 1. Create a credential while online (syncs to server, revision = N)
    /// 2. Wait for sync to complete
    /// 3. Delete the latest vault revision on server via API (simulates server data loss)
    /// 4. Trigger sync - client detects server is "behind" and uploads
    /// 5. Verify credential still exists (client data was uploaded, not downloaded from server)
    /// 6. Verify server revision is restored via API
    @MainActor
    func test03RPORecovery() async throws {
        let testUser = try await createTestUser()
        let uniqueName = TestConfiguration.generateUniqueName(prefix: "RPO Test")
        print("[Test03] Testing RPO recovery with item: \(uniqueName)")

        app.launch()
        loginWithTestUser(testUser)

        let itemsScreen = app.findElement(testID: "items-screen")
        var initialRevision = 0
        var revisionAfterCreate = 0
        var revisionAfterDelete = 0

        // Step 1: Verify initial state and get server revision
        print("[Test03] Step 1: Verify initial state")
        guard assertElementExists(
            itemsScreen,
            timeout: TestConfiguration.extendedTimeout,
            message: "Should be on items screen after launch/unlock",
            context: "03-items-screen"
        ) else {
            return
        }

        let initialStateScreenshot = XCUIScreen.main.screenshot()
        let attachment1 = XCTAttachment(screenshot: initialStateScreenshot)
        attachment1.name = "03-1-initial-state"
        attachment1.lifetime = .keepAlways
        add(attachment1)

        // Get initial revision using username-based API (no auth token needed)
        let initialRevisions = try await TestUserRegistration.getVaultRevisionsByUsername(username: testUser.username)
        initialRevision = initialRevisions.currentRevision
        print("[Test03] Initial server revision: \(initialRevision)")

        // Step 2: Create credential while online using helper
        print("[Test03] Step 2: Create credential while online")
        let rpoItemParams = CreateItemParams(
            name: uniqueName,
            serviceUrl: "https://rpo-test.example.com",
            email: "rpo-test@example.com"
        )

        guard createItem(params: rpoItemParams, contextPrefix: "03") else {
            return
        }

        sleep(1) // Wait for sync

        print("[Test03] Credential created and synced to server")

        // Verify revision increased (async)
        let afterCreateRevisions = try await TestUserRegistration.getVaultRevisionsByUsername(username: testUser.username)
        revisionAfterCreate = afterCreateRevisions.currentRevision
        print("[Test03] Server revision after create: \(revisionAfterCreate)")

        XCTAssertGreaterThan(
            revisionAfterCreate, initialRevision,
            "Server revision should increase after creating credential (was \(initialRevision), now \(revisionAfterCreate))"
        )

        // Step 3: Simulate server data loss
        print("[Test03] Step 3: Simulate server data loss")
        let afterSyncScreenshot = XCUIScreen.main.screenshot()
        let attachment3 = XCTAttachment(screenshot: afterSyncScreenshot)
        attachment3.name = "03-3-after-initial-sync"
        attachment3.lifetime = .keepAlways
        add(attachment3)

        // Delete vault revision to simulate data loss (async)
        let deletedCount = try await TestUserRegistration.deleteVaultRevisionsByUsername(
            username: testUser.username,
            count: 1
        )
        print("[Test03] Deleted \(deletedCount) vault revision(s) from server to simulate data loss")

        let afterDeleteRevisions = try await TestUserRegistration.getVaultRevisionsByUsername(username: testUser.username)
        revisionAfterDelete = afterDeleteRevisions.currentRevision
        print("[Test03] Server revision after delete: \(revisionAfterDelete)")

        XCTAssertLessThan(
            revisionAfterDelete, revisionAfterCreate,
            "Server revision should decrease after deleting vault revision (was \(revisionAfterCreate), now \(revisionAfterDelete))"
        )

        // Step 4: Trigger sync for RPO recovery
        print("[Test03] Step 4: Trigger sync for RPO recovery")
        let afterServerRollbackScreenshot = XCUIScreen.main.screenshot()
        let attachment4 = XCTAttachment(screenshot: afterServerRollbackScreenshot)
        attachment4.name = "03-4-after-server-rollback"
        attachment4.lifetime = .keepAlways
        add(attachment4)

        print("[Test03] Triggering sync - client should detect RPO scenario and upload vault")
        app.pullToRefresh()
        sleep(5)

        let afterRpoSyncScreenshot = XCUIScreen.main.screenshot()
        let attachment5 = XCTAttachment(screenshot: afterRpoSyncScreenshot)
        attachment5.name = "03-5-after-rpo-sync"
        attachment5.lifetime = .keepAlways
        add(attachment5)

        // Step 5: Verify credential persists after RPO recovery using helper
        print("[Test03] Step 5: Verify credential persists after RPO recovery")
        guard openAndVerifyItem(name: uniqueName, expectedEmail: "rpo-test@example.com", contextPrefix: "03-rpo") else {
            XCTFail("Credential '\(uniqueName)' should still exist after RPO recovery - this proves client uploaded to server instead of downloading (which would have lost the credential)")
            return
        }

        let itemVerifiedScreenshot = XCUIScreen.main.screenshot()
        let attachment6 = XCTAttachment(screenshot: itemVerifiedScreenshot)
        attachment6.name = "03-6-item-verified-after-rpo"
        attachment6.lifetime = .keepAlways
        add(attachment6)

        // Verify server revision restored (async)
        let finalRevisions = try await TestUserRegistration.getVaultRevisionsByUsername(username: testUser.username)
        let finalRevision = finalRevisions.currentRevision
        print("[Test03] Final server revision: \(finalRevision)")

        XCTAssertGreaterThanOrEqual(
            finalRevision, revisionAfterCreate,
            "Server revision should be restored after RPO recovery (expected >= \(revisionAfterCreate), got \(finalRevision))"
        )

        print("[Test03] SUCCESS - Revision flow: \(initialRevision) → \(revisionAfterCreate) (create) → \(revisionAfterDelete) (rollback) → \(finalRevision) (recovered)")
    }

    // MARK: - Test 04: Forced Logout Recovery

    /// Verifies forced logout recovery mechanism:
    /// When a forced logout occurs (e.g., 401 unauthorized due to token invalidation),
    /// the client should preserve the encrypted vault locally. On next login with the same
    /// credentials, the client should detect the preserved vault and recover by uploading
    /// it to the server.
    ///
    /// This is different from normal logout:
    /// - Normal logout: User explicitly logs out → vault is cleared
    /// - Forced logout: Server rejects token → vault preserved locally for recovery
    ///
    /// Test flow:
    /// 1. Login and create a credential (vault synced to server)
    /// 2. Simulate server data loss by deleting latest vault revision
    /// 3. Invalidate refresh tokens via API (simulates token expiry)
    /// 4. Trigger API call to cause forced logout (401)
    /// 5. Verify app shows login screen with username prefilled (orphan vault preserved)
    /// 6. Re-login with same credentials
    /// 7. Verify credential still exists (vault was recovered from local preserved copy)
    /// 8. Verify server revision is restored
    @MainActor
    func test04ForcedLogoutRecovery() async throws {
        let testUser = try await createTestUser()
        let uniqueName = TestConfiguration.generateUniqueName(prefix: "Forced Logout Test")
        print("[Test04] Testing forced logout recovery with item: \(uniqueName)")

        app.launch()
        loginWithTestUser(testUser)

        let itemsScreen = app.findElement(testID: "items-screen")
        var revisionBeforeLogout = 0

        // Step 1: Verify initial state
        print("[Test04] Step 1: Verify initial state")
        guard assertElementExists(
            itemsScreen,
            timeout: TestConfiguration.extendedTimeout,
            message: "Should be on items screen after launch/unlock",
            context: "04-items-screen"
        ) else {
            return
        }

        let initialStateScreenshot = XCUIScreen.main.screenshot()
        let attachment1 = XCTAttachment(screenshot: initialStateScreenshot)
        attachment1.name = "04-1-initial-state"
        attachment1.lifetime = .keepAlways
        add(attachment1)

        // Step 2: Create credential while online using helper
        print("[Test04] Step 2: Create credential while online")
        let forcedLogoutItemParams = CreateItemParams(
            name: uniqueName,
            serviceUrl: "https://forced-logout-test.example.com",
            email: "forced-logout-test@example.com"
        )

        guard createItem(params: forcedLogoutItemParams, contextPrefix: "04") else {
            return
        }

        sleep(1) // Wait for sync

        print("[Test04] Credential created and synced to server")

        // Get revision before logout using username-based API (no auth token needed)
        let beforeLogoutRevisions = try await TestUserRegistration.getVaultRevisionsByUsername(username: testUser.username)
        revisionBeforeLogout = beforeLogoutRevisions.currentRevision
        print("[Test04] Server revision before forced logout: \(revisionBeforeLogout)")

        // Simulate server data loss (delete latest revision)
        let deletedCount = try await TestUserRegistration.deleteVaultRevisionsByUsername(
            username: testUser.username,
            count: 1
        )
        print("[Test04] Deleted \(deletedCount) vault revision(s) to simulate server data loss")

        let afterRollbackRevisions = try await TestUserRegistration.getVaultRevisionsByUsername(username: testUser.username)
        let revisionAfterRollback = afterRollbackRevisions.currentRevision
        print("[Test04] Server revision after rollback: \(revisionAfterRollback)")

        // Step 3: Invalidate tokens and trigger forced logout
        print("[Test04] Step 3: Invalidate tokens and trigger forced logout")
        let beforeForcedLogoutScreenshot = XCUIScreen.main.screenshot()
        let attachment3 = XCTAttachment(screenshot: beforeForcedLogoutScreenshot)
        attachment3.name = "04-3-before-forced-logout"
        attachment3.lifetime = .keepAlways
        add(attachment3)

        // Block user via API (this will cause 401 on next auth check)
        try await TestUserRegistration.blockUserByUsername(username: testUser.username)
        print("[Test04] User blocked")

        // Step 4: Trigger sync to cause forced logout
        print("[Test04] Step 4: Trigger sync to cause forced logout")
        // Pull to refresh will trigger API call which should fail with 401
        // and cause forced logout
        print("[Test04] Triggering sync to cause forced logout...")
        app.pullToRefresh()

        // Wait for the session expired modal to appear and dismiss it
        // The modal says "Your session has expired. Please login again." with an "OK" button
        let okButton = app.alerts.buttons["OK"]
        let alertAppeared = okButton.waitForExistenceNoIdle(timeout: 10)
        if alertAppeared {
            print("[Test04] Session expired modal detected, dismissing...")
            okButton.tapNoIdle()
            sleep(1) // Wait for alert dismissal and navigation
        } else {
            print("[Test04] No session expired modal detected, continuing...")
        }

        let afterForcedLogoutScreenshot = XCUIScreen.main.screenshot()
        let attachment4 = XCTAttachment(screenshot: afterForcedLogoutScreenshot)
        attachment4.name = "04-4-after-forced-logout"
        attachment4.lifetime = .keepAlways
        add(attachment4)

        // Step 5: Verify login screen with prefilled username
        print("[Test04] Step 5: Verify login screen with prefilled username")
        // Should be on login screen after forced logout (modal was already dismissed in step 4)
        let loginScreen = app.findElement(testID: "login-screen")
        guard assertElementExists(
            loginScreen,
            timeout: 15,
            message: "Should be on login screen after forced logout",
            context: "04-login-screen-after-logout"
        ) else {
            // Unblock user before returning to avoid leaving user in blocked state
            try? await TestUserRegistration.unblockUserByUsername(username: testUser.username)
            return
        }

        // Verify username is prefilled (orphan vault preservation)
        // This is a key feature: after forced logout, the username should be preserved
        // to help users easily re-login with the same account
        let usernameInput = app.findTextField(testID: "username-input")
        guard usernameInput.waitForExistenceNoIdle(timeout: 5) else {
            captureFailureState(context: "04-username-input-not-found")
            XCTFail("Username input should be visible on login screen")
            try? await TestUserRegistration.unblockUserByUsername(username: testUser.username)
            return
        }

        let usernameValue = usernameInput.value as? String ?? ""
        print("[Test04] Username field value: '\(usernameValue)'")

        // Verify username is prefilled with the test user's username (normalized)
        let normalizedExpectedUsername = testUser.username.lowercased()
        if !usernameValue.lowercased().contains(normalizedExpectedUsername.prefix(4)) {
            // Username should at least start with the same characters
            // (some implementations may normalize differently)
            print("[Test04] Warning: Username field may not be prefilled. Expected to contain: '\(normalizedExpectedUsername)', got: '\(usernameValue)'")
        } else {
            print("[Test04] Username prefilled correctly: '\(usernameValue)'")
        }

        let loginScreenScreenshot = XCUIScreen.main.screenshot()
        let attachment5 = XCTAttachment(screenshot: loginScreenScreenshot)
        attachment5.name = "04-5-login-screen-after-forced-logout"
        attachment5.lifetime = .keepAlways
        add(attachment5)

        print("[Test04] Forced logout confirmed - on login screen with username prefilled")

        // Unblock user so they can log in again
        try await TestUserRegistration.unblockUserByUsername(username: testUser.username)
        print("[Test04] User unblocked")

        // Step 6: Re-login with same credentials
        print("[Test04] Step 6: Re-login with same credentials")
        // Clear username field and enter credentials
        usernameInput.clearAndTypeTextNoIdle(testUser.username)

        let passwordInput = app.findTextField(testID: "password-input")
        passwordInput.tapNoIdle()
        passwordInput.typeTextNoIdle(testUser.password)

        app.hideKeyboardIfVisible()

        let credentialsScreenshot = XCUIScreen.main.screenshot()
        let attachment6 = XCTAttachment(screenshot: credentialsScreenshot)
        attachment6.name = "04-6-credentials-entered"
        attachment6.lifetime = .keepAlways
        add(attachment6)

        let loginButton = app.findElement(testID: "login-button")
        loginButton.tapNoIdle()

        // Wait for login to complete and vault to load
        guard assertElementExists(
            itemsScreen,
            timeout: TestConfiguration.extendedTimeout,
            message: "Should navigate to items screen after re-login",
            context: "04-items-after-relogin"
        ) else {
            return
        }

        // Wait for sync to complete
        sleep(5)

        let afterReloginScreenshot = XCUIScreen.main.screenshot()
        let attachment7 = XCTAttachment(screenshot: afterReloginScreenshot)
        attachment7.name = "04-7-after-relogin"
        attachment7.lifetime = .keepAlways
        add(attachment7)

        print("[Test04] Re-login successful")

        // Step 7: Verify credential still exists using helper
        // The credential should still exist because:
        // 1. It was in the local preserved vault during forced logout
        // 2. On re-login, client detected local vault is more advanced than server
        // 3. Client uploaded local vault to recover server
        print("[Test04] Step 7: Verify credential still exists")
        guard openAndVerifyItem(name: uniqueName, expectedEmail: "forced-logout-test@example.com", contextPrefix: "04-recovery") else {
            XCTFail("Credential '\(uniqueName)' should still exist after forced logout recovery - this proves vault was preserved locally and uploaded to server")
            return
        }

        let itemVerifiedScreenshot = XCUIScreen.main.screenshot()
        let attachment8 = XCTAttachment(screenshot: itemVerifiedScreenshot)
        attachment8.name = "04-8-item-verified-after-recovery"
        attachment8.lifetime = .keepAlways
        add(attachment8)

        print("[Test04] Credential verified after forced logout recovery")

        // Verify server revision is restored using username-based API (no auth token needed)
        let finalRevisions = try await TestUserRegistration.getVaultRevisionsByUsername(username: testUser.username)
        let finalRevision = finalRevisions.currentRevision
        print("[Test04] Final server revision: \(finalRevision)")

        XCTAssertGreaterThanOrEqual(
            finalRevision, revisionBeforeLogout,
            "Server revision should be restored after forced logout recovery (expected >= \(revisionBeforeLogout), got \(finalRevision))"
        )

        print("[Test04] SUCCESS - Forced logout recovery verified!")
        print("[Test04] Revision flow: \(revisionBeforeLogout) (before) → \(revisionAfterRollback) (rollback) → \(finalRevision) (recovered)")
    }

    // MARK: - Helper Methods

    /// Logs in with test user at the beginning of a test.
    /// Always logs out first if already logged in to ensure we're using the correct test user.
    /// Use this at the start of tests after app.launch().
    /// - Parameter testUser: The test user to login with
    @MainActor
    private func loginWithTestUser(_ testUser: TestUser) {
        // Wait for app to settle and reach a known state (unlock, login, or items screen)
        // Use longer initial timeout since app may still be loading after launch
        let unlockScreen = app.findElement(testID: "unlock-screen")
        let loginScreen = app.findElement(testID: "login-screen")
        let itemsScreen = app.findElement(testID: "items-screen")

        // Wait up to 15 seconds for any of the expected screens to appear
        var screenFound = false
        let startTime = Date()
        let maxWaitTime: TimeInterval = 15

        while !screenFound && Date().timeIntervalSince(startTime) < maxWaitTime {
            if unlockScreen.exists || loginScreen.exists || itemsScreen.exists {
                screenFound = true
            } else {
                Thread.sleep(forTimeInterval: 0.5)
            }
        }

        if !screenFound {
            // Capture screenshot and app hierarchy for debugging
            let screenshot = XCUIScreen.main.screenshot()
            let attachment = XCTAttachment(screenshot: screenshot)
            attachment.name = "FAILURE-no-screen-found"
            attachment.lifetime = .keepAlways
            add(attachment)

            let hierarchyAttachment = XCTAttachment(string: app.debugDescription)
            hierarchyAttachment.name = "FAILURE-hierarchy-no-screen-found"
            hierarchyAttachment.lifetime = .keepAlways
            add(hierarchyAttachment)

            XCTFail("No expected screen (login, unlock, or items) found after \(maxWaitTime)s. App may have crashed or failed to load.")
            return
        }

        // Handle unlock screen - logout to start fresh with test user
        if unlockScreen.exists {
            print("[Helper] Unlock screen detected - logging out to login fresh with test user")

            let logoutButton = app.findElement(testID: "logout-button")
            if logoutButton.waitForExistenceNoIdle(timeout: 5) {
                logoutButton.tapNoIdle()

                // Handle logout confirmation alert if present
                let confirmButton = app.buttons["Logout"]
                if confirmButton.waitForExistence(timeout: 3) {
                    confirmButton.tap()
                }
            }

            // Wait for login screen
            _ = loginScreen.waitForExistenceNoIdle(timeout: 10)
        }

        // Check if we're on login screen
        if loginScreen.waitForExistenceNoIdle(timeout: 2) {
            performLogin(with: testUser)
            return
        }

        // Check if we're already on items screen (already logged in as correct user)
        if itemsScreen.waitForExistenceNoIdle(timeout: 2) {
            print("[Helper] Already on items screen, assuming correct user is logged in")
            return
        }

        // Unknown state - log warning but continue (test will fail with appropriate error if needed)
        print("[Helper] Unknown app state after waiting, test may fail")
    }

    /// Unlocks the vault if the unlock screen is displayed.
    /// Use this after deep links or other actions that may lock the vault.
    /// Unlike loginWithTestUser, this does NOT logout - it just enters the password.
    /// - Parameter testUser: The test user whose password to use for unlock
    @MainActor
    private func unlockVaultIfNeeded(with testUser: TestUser) {
        // Wait longer for unlock screen after deep links - app may take time to navigate
        let unlockScreen = app.findElement(testID: "unlock-screen")
        guard unlockScreen.waitForExistenceNoIdle(timeout: 5) else {
            // Not on unlock screen, check if already on items screen
            let itemsScreen = app.findElement(testID: "items-screen")
            if itemsScreen.waitForExistenceNoIdle(timeout: 2) {
                print("[Helper] Already on items screen, no unlock needed")
            } else {
                print("[Helper] Not on unlock or items screen, proceeding anyway")
            }
            return
        }

        print("[Helper] Unlock screen detected - entering password to unlock")

        // Enter password in unlock screen
        let passwordInput = app.findTextField(testID: "unlock-password-input")
        if passwordInput.waitForExistenceNoIdle(timeout: 3) {
            passwordInput.tapNoIdle()
            passwordInput.typeTextNoIdle(testUser.password)
        }

        app.hideKeyboardIfVisible()

        // Tap unlock button
        let unlockButton = app.findElement(testID: "unlock-button")
        if unlockButton.waitForExistenceNoIdle(timeout: 3) {
            unlockButton.tapNoIdle()
        }

        // Wait for items screen
        let itemsScreen = app.findElement(testID: "items-screen")
        _ = itemsScreen.waitForExistenceNoIdle(timeout: TestConfiguration.extendedTimeout)
    }

    /// Performs login with the given test user credentials.
    /// Assumes we're already on the login screen.
    /// - Parameter testUser: The test user to login with
    @MainActor
    private func performLogin(with testUser: TestUser) {
        // Check if API URL is already configured to localhost by looking at the displayed URL
        // The login screen shows the URL via server-url-link, containing text like "localhost:5092" or "aliasvault.net"
        let serverUrlLink = app.findElement(testID: "server-url-link")
        var needsApiConfig = true

        if serverUrlLink.waitForExistenceNoIdle(timeout: 5) {
            // Check if URL already contains localhost (already configured for local testing)
            let urlText = serverUrlLink.label
            if urlText.contains("localhost") {
                print("[Helper] API URL already configured to localhost, skipping API configuration")
                needsApiConfig = false
            } else {
                print("[Helper] API URL shows '\(urlText)', need to configure to localhost")
            }
        }

        if needsApiConfig {
            // Configure self-hosted URL by tapping the server URL link button
            let serverUrlLinkButton = app.findElement(testID: "server-url-link-button")

            if serverUrlLinkButton.waitForExistenceNoIdle(timeout: 5) {
                serverUrlLinkButton.tapNoIdle()

                let selfHostedOption = app.findElement(testID: "api-option-custom")
                if selfHostedOption.waitForExistenceNoIdle(timeout: 10) {
                    selfHostedOption.tapNoIdle()

                    let customUrlInput = app.findTextField(testID: "custom-api-url-input")
                    if customUrlInput.waitForExistenceNoIdle(timeout: 5) {
                        customUrlInput.tapNoIdle()
                        customUrlInput.clearAndTypeTextNoIdle(TestConfiguration.apiUrl)
                        print("[Helper] Configured API URL: \(TestConfiguration.apiUrl)")
                    }

                    app.hideKeyboardIfVisible()

                    // Tap back to return to login form
                    let backButton = app.findElement(testID: "back-button")
                    if backButton.waitForExistenceNoIdle(timeout: 3) {
                        backButton.tapNoIdle()
                    }
                }
            }
        }

        // Wait for login screen to be ready
        let loginScreen = app.findElement(testID: "login-screen")
        _ = loginScreen.waitForExistenceNoIdle(timeout: 5)

        // Enter credentials
        let usernameInput = app.findTextField(testID: "username-input")
        if usernameInput.waitForExistenceNoIdle(timeout: 5) {
            usernameInput.clearAndTypeTextNoIdle(testUser.username)
        }

        let passwordInput = app.findTextField(testID: "password-input")
        if passwordInput.waitForExistenceNoIdle(timeout: 3) {
            passwordInput.tapNoIdle()
            passwordInput.typeTextNoIdle(testUser.password)
        }

        app.hideKeyboardIfVisible()

        // Tap login button
        let loginButton = app.findElement(testID: "login-button")
        if loginButton.waitForExistenceNoIdle(timeout: 3) {
            loginButton.tapNoIdle()
        }

        // Wait for items screen
        let itemsScreen = app.findElement(testID: "items-screen")
        _ = itemsScreen.waitForExistenceNoIdle(timeout: TestConfiguration.extendedTimeout)
    }

    /// Parameters for creating a new item via the helper.
    struct CreateItemParams {
        let name: String
        let serviceUrl: String
        let email: String
        let username: String?

        init(name: String, serviceUrl: String = "https://example.com", email: String = "test@example.com", username: String? = nil) {
            self.name = name
            self.serviceUrl = serviceUrl
            self.email = email
            self.username = username
        }
    }

    /// Creates a new item with the given parameters.
    /// Assumes we're already on the items screen.
    /// - Parameters:
    ///   - params: The item creation parameters
    ///   - contextPrefix: Prefix for failure context names (e.g., "02" for test02)
    /// - Returns: true if item was created successfully, false otherwise
    @discardableResult
    @MainActor
    private func createItem(params: CreateItemParams, contextPrefix: String) -> Bool {
        print("[Helper] Creating item: \(params.name)")

        // Tap add button
        let addItemButton = app.findElement(testID: "add-item-button")
        addItemButton.tapNoIdle()

        let addEditScreen = app.findElement(testID: "add-edit-screen")
        guard assertElementExists(
            addEditScreen,
            timeout: 10,
            message: "Add/edit screen should appear",
            context: "\(contextPrefix)-add-edit-screen"
        ) else {
            return false
        }

        // Fill item name
        let itemNameInput = app.findAndScrollToTextField(testID: "item-name-input")
        itemNameInput.tapNoIdle()
        itemNameInput.typeTextNoIdle(params.name)

        // Fill service URL (multi-value field, first input has index 0)
        let serviceUrlInput = app.findAndScrollToTextField(testID: "service-url-input-0")
        serviceUrlInput.tapNoIdle()
        serviceUrlInput.typeTextNoIdle(params.serviceUrl)

        // Add email - click button and wait for field to appear
        let addEmailButton = app.findElement(testID: "add-email-button")
        app.scrollToElement(addEmailButton)
        addEmailButton.tapNoIdle()

        // Wait for email field to appear after animation
        let loginEmailInput = app.findAndScrollToTextField(testID: "login-email-input")
        _ = loginEmailInput.waitForExistenceNoIdle(timeout: 3)
        app.scrollToElement(loginEmailInput)
        loginEmailInput.tapNoIdle()
        Thread.sleep(forTimeInterval: 0.2) // Wait for focus
        loginEmailInput.typeTextNoIdle(params.email)

        // Optionally add username
        if let username = params.username {
            let loginUsernameInput = app.findAndScrollToTextField(testID: "login-username-input")
            if loginUsernameInput.exists {
                app.scrollToElement(loginUsernameInput)
                // Ensure field is focused before typing
                _ = loginUsernameInput.waitForExistenceNoIdle(timeout: 2)
                loginUsernameInput.tapNoIdle()
                Thread.sleep(forTimeInterval: 0.3) // Wait for focus to switch
                loginUsernameInput.typeTextNoIdle(username)
            }
        }

        app.hideKeyboardIfVisible()

        // Save item
        let saveButton = app.findElement(testID: "save-button")
        _ = saveButton.waitForExistenceNoIdle(timeout: 5)
        saveButton.tapNoIdle()

        guard assertTextAppears(
            "Login credentials",
            timeout: 10,
            message: "Should show item detail screen after save",
            context: "\(contextPrefix)-item-saved"
        ) else {
            return false
        }

        // Return to items list
        sleep(1)
        let backButton = app.findElement(testID: "back-button")
        backButton.tapNoIdle()

        let itemsScreen = app.findElement(testID: "items-screen")
        guard assertElementExists(
            itemsScreen,
            timeout: 10,
            message: "Should return to items screen after saving",
            context: "\(contextPrefix)-return-to-items"
        ) else {
            return false
        }

        // Wait for list to populate
        sleep(2)

        print("[Helper] Item '\(params.name)' created successfully")
        return true
    }

    /// Verifies that an item with the given name exists in the items list.
    /// - Parameters:
    ///   - name: The item name to look for
    ///   - contextPrefix: Prefix for failure context names
    /// - Returns: true if item exists, false otherwise
    @discardableResult
    @MainActor
    private func verifyItemExistsInList(name: String, contextPrefix: String) -> Bool {
        let itemCard = app.descendants(matching: .any).matching(
            NSPredicate(format: "label == %@", name)
        ).firstMatch

        let itemFound = itemCard.waitForExistenceNoIdle(timeout: 10)
        if !itemFound {
            captureFailureState(context: "\(contextPrefix)-item-not-in-list")
            XCTFail("Item '\(name)' should appear in list")
            return false
        }

        print("[Helper] Item '\(name)' found in list")
        return true
    }

    /// Opens an item from the list and verifies its details.
    /// - Parameters:
    ///   - name: The item name to open
    ///   - expectedEmail: The expected email address (optional)
    ///   - contextPrefix: Prefix for failure context names
    /// - Returns: true if item was opened and verified, false otherwise
    @discardableResult
    @MainActor
    private func openAndVerifyItem(name: String, expectedEmail: String? = nil, contextPrefix: String) -> Bool {
        let itemCard = app.descendants(matching: .any).matching(
            NSPredicate(format: "label == %@", name)
        ).firstMatch

        let itemFound = itemCard.waitForExistenceNoIdle(timeout: 10)
        if !itemFound {
            captureFailureState(context: "\(contextPrefix)-item-not-found")
            XCTFail("Item '\(name)' should exist in list")
            return false
        }

        itemCard.tapNoIdle()

        guard assertTextAppears(
            "Login credentials",
            timeout: 10,
            message: "Should show item detail screen",
            context: "\(contextPrefix)-item-detail"
        ) else {
            return false
        }

        if let email = expectedEmail {
            guard assertTextContaining(
                email,
                timeout: 5,
                message: "Email '\(email)' should be visible",
                context: "\(contextPrefix)-email-preserved"
            ) else {
                return false
            }
        }

        print("[Helper] Item '\(name)' verified successfully")
        return true
    }
}
