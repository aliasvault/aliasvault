package net.aliasvault.app.passwordunlock

import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.animation.ObjectAnimator
import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.view.View
import android.view.WindowManager
import android.view.animation.AccelerateDecelerateInterpolator
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.Button
import android.widget.EditText
import android.widget.ImageButton
import android.widget.ProgressBar
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import net.aliasvault.app.R
import net.aliasvault.app.vaultstore.VaultStore
import net.aliasvault.app.vaultstore.keystoreprovider.AndroidKeystoreProvider
import net.aliasvault.app.vaultstore.storageprovider.AndroidStorageProvider

/**
 * Native password unlock activity.
 * This activity presents a password entry UI for vault unlocking.
 *
 * Result:
 * - RESULT_SUCCESS: Password verified, encryption key returned in EXTRA_ENCRYPTION_KEY
 * - RESULT_CANCELLED: User cancelled
 */
class PasswordUnlockActivity : AppCompatActivity() {

    companion object {
        /** Result code for successful password unlock. */
        const val RESULT_SUCCESS = Activity.RESULT_OK

        /** Result code for cancelled password unlock. */
        const val RESULT_CANCELLED = Activity.RESULT_CANCELED

        /** Intent extra key for the encryption key (returned on success). */
        const val EXTRA_ENCRYPTION_KEY = "encryption_key"

        /** Intent extra key for custom title (optional). */
        const val EXTRA_CUSTOM_TITLE = "custom_title"

        /** Intent extra key for custom subtitle (optional). */
        const val EXTRA_CUSTOM_SUBTITLE = "custom_subtitle"
    }

    private lateinit var vaultStore: VaultStore

    // UI components
    private lateinit var titleTextView: TextView
    private lateinit var subtitleTextView: TextView
    private lateinit var passwordEditText: EditText
    private lateinit var errorTextView: TextView
    private lateinit var errorContainer: View
    private lateinit var unlockButton: Button
    private lateinit var backButton: ImageButton
    private lateinit var loadingOverlay: View
    private lateinit var progressBar: ProgressBar

    // State
    private var isProcessing: Boolean = false
    private var isShowingError: Boolean = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_password_unlock)

        // Keep screen on during password entry
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        // Adjust for soft keyboard - pan mode to ensure button stays visible
        window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_PAN)

        // Apply window insets for safe area
        applyWindowInsets()

        // Initialize VaultStore
        vaultStore = VaultStore.getInstance(
            AndroidKeystoreProvider(this) { null },
            AndroidStorageProvider(this),
        )

        // Get custom title/subtitle from intent
        val customTitle = intent.getStringExtra(EXTRA_CUSTOM_TITLE)
        val customSubtitle = intent.getStringExtra(EXTRA_CUSTOM_SUBTITLE)

        // Initialize views
        initializeViews(customTitle, customSubtitle)
    }

    private fun initializeViews(customTitle: String?, customSubtitle: String?) {
        titleTextView = findViewById(R.id.titleTextView)
        subtitleTextView = findViewById(R.id.subtitleTextView)
        passwordEditText = findViewById(R.id.passwordEditText)
        errorTextView = findViewById(R.id.errorTextView)
        errorContainer = findViewById(R.id.errorContainer)
        unlockButton = findViewById(R.id.unlockButton)
        backButton = findViewById(R.id.backButton)
        loadingOverlay = findViewById(R.id.loadingOverlay)
        progressBar = findViewById(R.id.progressBar)

        // Set custom title/subtitle if provided
        if (!customTitle.isNullOrEmpty()) {
            titleTextView.text = customTitle
        } else {
            titleTextView.text = getString(R.string.password_unlock_title)
        }

        if (!customSubtitle.isNullOrEmpty()) {
            subtitleTextView.text = customSubtitle
        } else {
            subtitleTextView.text = getString(R.string.password_unlock_subtitle)
        }

        // Setup button states
        unlockButton.isEnabled = false

        // Animate views in on appear
        animateViewsIn()

        // Handle password input
        passwordEditText.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {
                // Not used
            }
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                // Not used
            }
            override fun afterTextChanged(s: Editable?) {
                // Only hide error if user is typing (not when we programmatically clear for error display)
                if (!isShowingError) {
                    hideError()
                }
                unlockButton.isEnabled = !s.isNullOrEmpty() && !isProcessing

                // Animate button scale based on enabled state
                val scale = if (!s.isNullOrEmpty() && !isProcessing) 1.0f else 0.98f
                unlockButton.animate()
                    .scaleX(scale)
                    .scaleY(scale)
                    .setDuration(200)
                    .setInterpolator(AccelerateDecelerateInterpolator())
                    .start()
            }
        })

        passwordEditText.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_DONE && unlockButton.isEnabled) {
                handleUnlock()
                true
            } else {
                false
            }
        }

        // Setup button click listeners
        unlockButton.setOnClickListener {
            handleUnlock()
        }

        backButton.setOnClickListener {
            setResult(RESULT_CANCELLED)
            finish()
        }

        // Focus password field and show keyboard after a short delay
        passwordEditText.postDelayed({
            passwordEditText.requestFocus()
            val imm = getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager
            imm.showSoftInput(passwordEditText, InputMethodManager.SHOW_IMPLICIT)
        }, 300)
    }

    private fun animateViewsIn() {
        // Fade in and translate logo
        titleTextView.alpha = 0f
        titleTextView.translationY = -20f
        titleTextView.animate()
            .alpha(1f)
            .translationY(0f)
            .setDuration(400)
            .setStartDelay(100)
            .setInterpolator(AccelerateDecelerateInterpolator())
            .start()

        // Fade in subtitle
        subtitleTextView.alpha = 0f
        subtitleTextView.animate()
            .alpha(1f)
            .setDuration(400)
            .setStartDelay(200)
            .start()

        // Fade in and scale password field
        passwordEditText.alpha = 0f
        passwordEditText.scaleX = 0.95f
        passwordEditText.scaleY = 0.95f
        passwordEditText.animate()
            .alpha(1f)
            .scaleX(1f)
            .scaleY(1f)
            .setDuration(400)
            .setStartDelay(300)
            .setInterpolator(AccelerateDecelerateInterpolator())
            .start()

        // Fade in button
        unlockButton.alpha = 0f
        unlockButton.animate()
            .alpha(1f)
            .setDuration(400)
            .setStartDelay(400)
            .start()
    }

    private fun handleUnlock() {
        val password = passwordEditText.text.toString()
        if (password.isEmpty()) {
            return
        }

        isProcessing = true
        unlockButton.isEnabled = false
        passwordEditText.isEnabled = false
        loadingOverlay.visibility = View.VISIBLE
        hideError()

        CoroutineScope(Dispatchers.Main).launch {
            try {
                val encryptionKey = withContext(Dispatchers.IO) {
                    vaultStore.verifyPassword(password)
                }

                if (encryptionKey != null) {
                    // Success - return encryption key
                    val resultIntent = Intent().apply {
                        putExtra(EXTRA_ENCRYPTION_KEY, encryptionKey)
                    }
                    setResult(RESULT_SUCCESS, resultIntent)
                    finish()
                } else {
                    // Incorrect password
                    showError(getString(R.string.password_unlock_incorrect))
                }
            } catch (e: Exception) {
                // Error during verification
                android.util.Log.e("PasswordUnlockActivity", "Password verification failed", e)
                showError(getString(R.string.password_unlock_error))
            } finally {
                isProcessing = false
                passwordEditText.isEnabled = true
                loadingOverlay.visibility = View.GONE
                // Update button state based on password field content
                unlockButton.isEnabled = passwordEditText.text?.isNotEmpty() == true
            }
        }
    }

    private fun showError(message: String) {
        errorTextView.text = message
        isShowingError = true

        // Animate error in with slide from top
        errorContainer.visibility = View.VISIBLE
        errorContainer.alpha = 0f
        errorContainer.translationY = -20f
        errorContainer.animate()
            .alpha(1f)
            .translationY(0f)
            .setDuration(300)
            .setInterpolator(AccelerateDecelerateInterpolator())
            .start()

        // Shake password field to indicate error
        val shake = ObjectAnimator.ofFloat(passwordEditText, "translationX", 0f, 25f, -25f, 25f, -25f, 15f, -15f, 6f, -6f, 0f)
        shake.duration = 600
        shake.start()

        passwordEditText.text?.clear()

        // Reset flag after clearing is done
        passwordEditText.post {
            isShowingError = false
        }

        passwordEditText.requestFocus()
    }

    private fun hideError() {
        if (errorContainer.visibility == View.VISIBLE) {
            isShowingError = false
            errorContainer.animate()
                .alpha(0f)
                .translationY(-20f)
                .setDuration(200)
                .setInterpolator(AccelerateDecelerateInterpolator())
                .setListener(object : AnimatorListenerAdapter() {
                    override fun onAnimationEnd(animation: Animator) {
                        errorContainer.visibility = View.GONE
                    }
                })
                .start()
        }
    }

    private fun applyWindowInsets() {
        findViewById<View>(android.R.id.content).setOnApplyWindowInsetsListener { _, insets ->
            val systemBarsInsets = insets.systemWindowInsets
            val backButtonParent = backButton.parent as View
            val layoutParams = backButtonParent.layoutParams as androidx.constraintlayout.widget.ConstraintLayout.LayoutParams
            layoutParams.topMargin = systemBarsInsets.top + 8
            backButtonParent.layoutParams = layoutParams

            insets
        }
    }

    override fun onBackPressed() {
        if (!isProcessing) {
            setResult(RESULT_CANCELLED)
            super.onBackPressed()
        }
    }
}
