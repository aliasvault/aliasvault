package net.aliasvault.app.utils

import android.app.Activity
import android.app.ActivityManager
import android.content.Context
import android.content.res.Configuration
import android.graphics.Color
import android.os.Build
import android.view.WindowManager
import androidx.annotation.RequiresApi
import androidx.core.content.edit

/**
 * Screen capture protection with two preferences: hiding the app contents in the recent apps screen, and blocking
 * screenshots and screen recordings via FLAG_SECURE (which hides the recent apps snapshot too).
 *
 * Other platform implementations: ScreenCaptureProtection.swift (iOS).
 */
object ScreenCaptureProtection {
    private const val PREFS_NAME = "AliasVaultPrefs"
    private const val KEY_ENABLED = "screen_capture_protection"
    private const val KEY_BLOCK_SCREENSHOTS = "block_screenshots"

    /**
     * Whether the app contents are hidden in the recent apps screen. Defaults to true.
     * @param context The context to read the preference with.
     * @return Whether the app contents are hidden.
     */
    fun isEnabled(context: Context): Boolean {
        return prefs(context).getBoolean(KEY_ENABLED, true)
    }

    /**
     * Store whether the app contents are hidden in the recent apps screen and apply it right away.
     * @param context The context to store the preference with.
     * @param enabled Whether the app contents are hidden.
     * @param activity The activity currently shown, if any.
     */
    fun setEnabled(context: Context, enabled: Boolean, activity: Activity?) {
        prefs(context).edit { putBoolean(KEY_ENABLED, enabled) }
        activity?.runOnUiThread { apply(activity) }
    }

    /**
     * Whether screenshots and screen recordings are blocked. Defaults to true.
     * @param context The context to read the preference with.
     * @return Whether screenshots are blocked.
     */
    fun isBlockScreenshotsEnabled(context: Context): Boolean {
        return prefs(context).getBoolean(KEY_BLOCK_SCREENSHOTS, true)
    }

    /**
     * Store whether screenshots and screen recordings are blocked and apply it right away.
     * @param context The context to store the preference with.
     * @param enabled Whether screenshots are blocked.
     * @param activity The activity currently shown, if any.
     */
    fun setBlockScreenshotsEnabled(context: Context, enabled: Boolean, activity: Activity?) {
        prefs(context).edit { putBoolean(KEY_BLOCK_SCREENSHOTS, enabled) }
        activity?.runOnUiThread { apply(activity) }
    }

    /**
     * Apply the stored preferences to the activity's window, again after a theme change so the recent apps color follows it.
     * @param activity The activity to apply the preferences to.
     */
    fun apply(activity: Activity) {
        val hideContents = isEnabled(activity)
        val secure = isBlockScreenshotsEnabled(activity) || (hideContents && Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU)

        if (secure) {
            activity.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        } else {
            activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            activity.setRecentsScreenshotEnabled(!hideContents)
            if (hideContents || secure) {
                setRecentsBackground(activity)
            }
        }
    }

    /** Show a plain white or black tile in the recent apps screen, following the device theme. */
    @RequiresApi(Build.VERSION_CODES.TIRAMISU)
    private fun setRecentsBackground(activity: Activity) {
        val isDarkMode = (activity.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
        val background = if (isDarkMode) Color.BLACK else Color.WHITE
        val description = ActivityManager.TaskDescription.Builder()
            .setBackgroundColor(background)
            .setStatusBarColor(background)
            .setNavigationBarColor(background)
            .build()
        activity.setTaskDescription(description)
    }

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
}
