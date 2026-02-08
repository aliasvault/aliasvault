package net.aliasvault.app

import android.util.Log
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.UiObject2
import androidx.test.uiautomator.Until

/**
 * UI test helper functions for Android instrumented tests.
 * Provides utilities for interacting with React Native views via UI Automator.
 */
object UITestHelpers {
    private const val TAG = "UITestHelpers"

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
     * Tap on an element with testID.
     */
    fun UiDevice.tapTestId(testId: String): Boolean {
        // Try immediate find first (no waiting)
        val element = findByTestId(testId)
        return if (element != null) {
            element.click()
            true
        } else {
            Log.e(TAG, "Failed to tap testId: $testId - element not found")
            false
        }
    }

    /**
     * Tap on an element with text.
     */
    fun UiDevice.tapText(text: String): Boolean {
        // Try immediate find first (no waiting)
        val element = findByText(text)
        return if (element != null) {
            element.click()
            true
        } else {
            Log.e(TAG, "Failed to tap text: $text - element not found")
            false
        }
    }

    /**
     * Type text into an element with testID.
     */
    fun UiDevice.typeIntoTestId(testId: String, text: String): Boolean {
        // Try immediate find first (no waiting)
        val element = findByTestId(testId)
        return if (element != null) {
            element.click()
            Thread.sleep(100) // Small delay for focus
            element.text = text
            true
        } else {
            Log.e(TAG, "Failed to type into testId: $testId - element not found")
            false
        }
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
        repeat(maxScrolls) {
            findByTestId(testId)?.let { return it }
            swipe(
                displayWidth / 2,
                displayHeight * 3 / 4,
                displayWidth / 2,
                displayHeight / 4,
                10,
            )
            Thread.sleep(300) // Wait for scroll to settle
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
        repeat(maxScrolls) {
            findByText(text)?.let { return it }
            swipe(
                displayWidth / 2,
                displayHeight * 3 / 4,
                displayWidth / 2,
                displayHeight / 4,
                10,
            )
            Thread.sleep(300) // Wait for scroll to settle
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
}
