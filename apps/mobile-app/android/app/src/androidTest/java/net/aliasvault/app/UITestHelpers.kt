package net.aliasvault.app

import android.util.Log
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.UiObject2
import androidx.test.uiautomator.Until
import java.io.File
import java.io.OutputStream

/**
 * UI test helper functions for Android instrumented tests.
 * Provides utilities for interacting with React Native views via UI Automator.
 */
object UITestHelpers {
    private const val TAG = "UITestHelpers"

    /**
     * Enable verbose logging for CI debugging.
     */
    private val verboseLogging: Boolean
        get() = TestConfiguration.isCI

    // region Element Finding

    /**
     * Find an element by its testID.
     * React Native on Android exposes testID via resource-id (without package prefix).
     */
    fun UiDevice.findByTestId(testId: String): UiObject2? {
        // Primary: resource-id without package prefix - this is where RN maps testID
        return findObject(By.res(testId))
    }

    /**
     * Find an element by text content.
     */
    fun UiDevice.findByText(text: String): UiObject2? {
        return findObject(By.text(text))
    }

    /**
     * Find an element by text containing a substring.
     */
    fun UiDevice.findByTextContains(text: String): UiObject2? {
        return findObject(By.textContains(text))
    }

    // endregion

    // region Waiting

    /**
     * Wait for an element with testID to exist.
     * Uses resource-id without package prefix (By.res) which is where React Native maps testID.
     */
    fun UiDevice.waitForTestId(
        testId: String,
        timeout: Long = TestConfiguration.DEFAULT_TIMEOUT_MS,
    ): UiObject2? {
        // Primary: resource-id without package prefix - this is where RN maps testID
        val result = wait(Until.findObject(By.res(testId)), timeout)
        if (result == null) {
            Log.w(TAG, "Timeout waiting for testId: $testId")
        }
        return result
    }

    /**
     * Wait for an element with text to exist.
     */
    fun UiDevice.waitForText(
        text: String,
        timeout: Long = TestConfiguration.SHORT_TIMEOUT_MS,
    ): UiObject2? {
        val result = wait(Until.findObject(By.text(text)), timeout)
        if (result == null) {
            Log.w(TAG, "Timeout waiting for text: $text")
        }
        return result
    }

    /**
     * Wait for an element with text containing substring to exist.
     */
    fun UiDevice.waitForTextContains(
        text: String,
        timeout: Long = TestConfiguration.SHORT_TIMEOUT_MS,
    ): UiObject2? {
        val result = wait(Until.findObject(By.textContains(text)), timeout)
        if (result == null) {
            Log.w(TAG, "Timeout waiting for text containing: $text")
        }
        return result
    }

    /**
     * Wait for an element to be gone.
     */
    fun UiDevice.waitForTestIdGone(
        testId: String,
        timeout: Long = TestConfiguration.SHORT_TIMEOUT_MS,
    ): Boolean {
        // Primary: resource-id without package prefix - this is where RN maps testID
        return wait(Until.gone(By.res(testId)), timeout) ?: true
    }

    /**
     * Wait for text to be gone.
     */
    fun UiDevice.waitForTextGone(
        text: String,
        timeout: Long = TestConfiguration.SHORT_TIMEOUT_MS,
    ): Boolean {
        return wait(Until.gone(By.text(text)), timeout) ?: false
    }

    // endregion

    // region Existence Checks

    /**
     * Check if an element with testID exists.
     */
    fun UiDevice.existsByTestId(testId: String): Boolean {
        return findByTestId(testId) != null
    }

    /**
     * Check if an element with text exists.
     */
    fun UiDevice.existsByText(text: String): Boolean {
        return findByText(text) != null
    }

    /**
     * Check if an element with text containing substring exists.
     */
    fun UiDevice.existsByTextContains(text: String): Boolean {
        return findByTextContains(text) != null
    }

    // endregion

    // region Actions

    /**
     * Maximum retries for flaky UI interactions in CI.
     */
    private val maxRetries: Int
        get() = if (TestConfiguration.isCI) 3 else 1

    /**
     * Tap on an element with testID.
     * Includes retry logic for CI headless mode where taps can be flaky.
     */
    fun UiDevice.tapTestId(testId: String): Boolean {
        repeat(maxRetries) { attempt ->
            val element = findByTestId(testId)
            if (element != null) {
                try {
                    element.click()
                    if (verboseLogging) {
                        Log.i(TAG, "Tapped testId: $testId (attempt ${attempt + 1})")
                    }
                    Thread.sleep(100) // Small delay after tap for UI to respond
                    return true
                } catch (e: Exception) {
                    Log.w(TAG, "Tap failed on attempt ${attempt + 1}: ${e.message}")
                    Thread.sleep(200)
                }
            } else if (attempt < maxRetries - 1) {
                if (verboseLogging) {
                    Log.w(TAG, "Element not found, waiting before retry ${attempt + 2}/$maxRetries")
                }
                Thread.sleep(500)
            }
        }
        Log.e(TAG, "Failed to tap testId: $testId after $maxRetries attempts")
        return false
    }

    /**
     * Tap on an element with text.
     * Includes retry logic for CI headless mode.
     */
    fun UiDevice.tapText(text: String): Boolean {
        repeat(maxRetries) { attempt ->
            val element = findByText(text)
            if (element != null) {
                try {
                    element.click()
                    if (verboseLogging) {
                        Log.i(TAG, "Tapped text: $text (attempt ${attempt + 1})")
                    }
                    Thread.sleep(100)
                    return true
                } catch (e: Exception) {
                    Log.w(TAG, "Tap failed on attempt ${attempt + 1}: ${e.message}")
                    Thread.sleep(200)
                }
            } else if (attempt < maxRetries - 1) {
                Thread.sleep(500)
            }
        }
        Log.e(TAG, "Failed to tap text: $text after $maxRetries attempts")
        return false
    }

    /**
     * Type text into an element with testID.
     * Includes retry logic and verification for CI headless mode.
     */
    fun UiDevice.typeIntoTestId(testId: String, text: String): Boolean {
        repeat(maxRetries) { attempt ->
            val element = findByTestId(testId)
            if (element != null) {
                try {
                    element.click()
                    Thread.sleep(150) // Slightly longer delay for focus in CI
                    element.text = text
                    Thread.sleep(100)

                    // Verify text was entered (important for CI)
                    val verifyElement = findByTestId(testId)
                    if (verifyElement?.text == text) {
                        if (verboseLogging) {
                            Log.i(TAG, "Typed into testId: $testId (attempt ${attempt + 1})")
                        }
                        return true
                    } else if (verboseLogging) {
                        Log.w(
                            TAG,
                            "Text verification failed: expected '$text', got '${verifyElement?.text}'",
                        )
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "Type failed on attempt ${attempt + 1}: ${e.message}")
                }
                Thread.sleep(300)
            } else if (attempt < maxRetries - 1) {
                Thread.sleep(500)
            }
        }
        Log.e(TAG, "Failed to type into testId: $testId after $maxRetries attempts")
        return false
    }

    /**
     * Clear text in an element with testID.
     */
    fun UiDevice.clearTestId(testId: String): Boolean {
        // Try immediate find first (no waiting)
        val element = findByTestId(testId)
        return if (element != null) {
            element.click()
            Thread.sleep(100) // Small delay for focus
            element.clear()
            true
        } else {
            Log.e(TAG, "Failed to clear testId: $testId - element not found")
            false
        }
    }

    // endregion

    // region Scrolling

    /**
     * Scroll down to find an element with testID.
     */
    fun UiDevice.scrollToTestId(
        testId: String,
        maxScrolls: Int = 5,
    ): UiObject2? {
        // Longer settle time in CI mode where rendering is slower
        val settleTime = if (TestConfiguration.isCI) 500L else 300L

        repeat(maxScrolls) {
            findByTestId(testId)?.let {
                if (verboseLogging) {
                    Log.i(TAG, "Found testId '$testId' after scroll")
                }
                return it
            }
            swipe(
                displayWidth / 2,
                displayHeight * 3 / 4,
                displayWidth / 2,
                displayHeight / 4,
                10,
            )
            Thread.sleep(settleTime)
        }
        return findByTestId(testId)
    }

    /**
     * Scroll down to find an element with text.
     */
    fun UiDevice.scrollToText(
        text: String,
        maxScrolls: Int = 5,
    ): UiObject2? {
        // Longer settle time in CI mode where rendering is slower
        val settleTime = if (TestConfiguration.isCI) 500L else 300L

        repeat(maxScrolls) {
            findByText(text)?.let {
                if (verboseLogging) {
                    Log.i(TAG, "Found text '$text' after scroll")
                }
                return it
            }
            swipe(
                displayWidth / 2,
                displayHeight * 3 / 4,
                displayWidth / 2,
                displayHeight / 4,
                10,
            )
            Thread.sleep(settleTime)
        }
        return findByText(text)
    }

    // endregion

    // region Navigation

    /**
     * Navigate back using the device back button.
     */
    fun UiDevice.navigateBack() {
        pressBack()
        Thread.sleep(500) // Wait for navigation animation
    }

    /**
     * Navigate home using the device home button.
     */
    fun UiDevice.navigateHome() {
        pressHome()
        Thread.sleep(500) // Wait for navigation animation
    }

    // endregion

    // region Assert Helpers

    /**
     * Assert that an element with testID exists.
     */
    fun UiDevice.assertTestIdExists(
        testId: String,
        timeout: Long = TestConfiguration.DEFAULT_TIMEOUT_MS,
    ) {
        val element = waitForTestId(testId, timeout)
        if (element == null) {
            throw AssertionError("Expected element with testId '$testId' to exist, but it was not found")
        }
    }

    /**
     * Assert that an element with text exists.
     */
    fun UiDevice.assertTextExists(
        text: String,
        timeout: Long = TestConfiguration.DEFAULT_TIMEOUT_MS,
    ) {
        val element = waitForText(text, timeout)
        if (element == null) {
            throw AssertionError("Expected element with text '$text' to exist, but it was not found")
        }
    }

    /**
     * Assert that an element with text containing substring exists.
     */
    fun UiDevice.assertTextContains(
        text: String,
        timeout: Long = TestConfiguration.DEFAULT_TIMEOUT_MS,
    ) {
        val element = waitForTextContains(text, timeout)
        if (element == null) {
            throw AssertionError(
                "Expected element containing text '$text' to exist, but it was not found",
            )
        }
    }

    /**
     * Assert that an element with testID does not exist.
     */
    fun UiDevice.assertTestIdNotExists(testId: String) {
        val element = findByTestId(testId)
        if (element != null) {
            throw AssertionError("Expected element with testId '$testId' to NOT exist, but it was found")
        }
    }

    /**
     * Assert that an element with text does not exist.
     */
    fun UiDevice.assertTextNotExists(text: String) {
        val element = findByText(text)
        if (element != null) {
            throw AssertionError("Expected element with text '$text' to NOT exist, but it was found")
        }
    }

    // endregion

    // region Text Field Helpers

    /**
     * Get the text value from an element with testID.
     */
    fun UiDevice.getTextFromTestId(testId: String): String? {
        return findByTestId(testId)?.text
    }

    /**
     * Check if a text field with testID has specific text.
     */
    fun UiDevice.testIdHasText(testId: String, expectedText: String): Boolean {
        return findByTestId(testId)?.text == expectedText
    }

    // endregion

    // region Keyboard

    /**
     * Hide the keyboard if visible.
     * Uses pressKeyCode for the BACK key which is safer than pressBack() for keyboard dismissal.
     */
    fun UiDevice.hideKeyboard() {
        // Check if any input field is focused (keyboard likely visible)
        val focusedElement = findObject(By.focused(true))
        if (focusedElement != null) {
            // Press KEYCODE_ESCAPE to dismiss keyboard without triggering navigation
            // Fallback to clicking outside if that doesn't work
            pressKeyCode(android.view.KeyEvent.KEYCODE_ESCAPE)
            Thread.sleep(200)

            // If still focused, try clicking on the screen outside the keyboard area
            val stillFocused = findObject(By.focused(true))
            if (stillFocused != null) {
                // Click near the top of the screen (header area) to dismiss keyboard
                click(displayWidth / 2, 100)
                Thread.sleep(200)
            }
        }
    }

    // endregion

    // region Sleep Helpers

    /**
     * Short sleep for UI to update.
     */
    fun shortSleep() {
        Thread.sleep(500)
    }

    /**
     * Medium sleep for animations.
     */
    fun mediumSleep() {
        Thread.sleep(1000)
    }

    /**
     * Long sleep for network operations.
     */
    fun longSleep() {
        Thread.sleep(2000)
    }

    // endregion

    // region Debug Helpers

    /**
     * Take a screenshot and save to file with error handling.
     * Returns true if screenshot was saved successfully.
     */
    fun UiDevice.saveScreenshot(file: File): Boolean {
        return try {
            // Ensure parent directory exists
            file.parentFile?.mkdirs()
            // Use the UiDevice's built-in takeScreenshot method
            val success = this.takeScreenshot(file)
            if (success) {
                Log.i(TAG, "Screenshot saved to: ${file.absolutePath}")
            } else {
                Log.e(TAG, "takeScreenshot returned false for: ${file.absolutePath}")
            }
            success
        } catch (e: Exception) {
            Log.e(TAG, "Failed to take screenshot: ${e.message}")
            e.printStackTrace()
            false
        }
    }

    /**
     * Dump the current window hierarchy for debugging with error handling.
     */
    fun UiDevice.dumpHierarchy(output: OutputStream) {
        try {
            this.dumpWindowHierarchy(output)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to dump window hierarchy: ${e.message}")
        }
    }

    /**
     * Log current screen state for debugging.
     */
    fun UiDevice.logScreenState(context: String) {
        if (!verboseLogging) return

        Log.i(TAG, "=== Screen state at: $context ===")
        Log.i(TAG, "  Display: ${displayWidth}x$displayHeight")

        // Check common screens
        val screens = listOf(
            "login-screen",
            "unlock-screen",
            "items-screen",
            "add-edit-screen",
        )

        for (screen in screens) {
            if (findByTestId(screen) != null) {
                Log.i(TAG, "  ✓ $screen is visible")
            }
        }
        Log.i(TAG, "=== End screen state ===")
    }

    // endregion
}
