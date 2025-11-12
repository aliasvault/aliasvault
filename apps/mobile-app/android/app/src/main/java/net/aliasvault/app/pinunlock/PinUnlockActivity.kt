package net.aliasvault.app.pinunlock

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import net.aliasvault.app.R
import net.aliasvault.app.vaultstore.VaultStore

/**
 * Native PIN unlock activity matching iOS PinUnlockView.
 * This activity presents a numpad UI for PIN entry and handles vault unlocking.
 */
class PinUnlockActivity : AppCompatActivity() {

    companion object {
        /** Result code for successful PIN unlock. */
        const val RESULT_SUCCESS = Activity.RESULT_OK

        /** Result code for cancelled PIN unlock. */
        const val RESULT_CANCELLED = Activity.RESULT_CANCELED

        /** Result code when PIN was disabled due to max attempts. */
        const val RESULT_PIN_DISABLED = 100

        /** Intent extra key for the encryption key. */
        const val EXTRA_ENCRYPTION_KEY = "encryption_key"
    }

    private lateinit var vaultStore: VaultStore
    private lateinit var pinDotsContainer: LinearLayout
    private lateinit var pinTextView: TextView
    private lateinit var errorTextView: TextView
    private lateinit var loadingOverlay: View
    private lateinit var progressBar: ProgressBar

    private var pinLength: Int? = null
    private var currentPin: String = ""
    private var isUnlocking: Boolean = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_pin_unlock)

        // Keep screen on during PIN entry
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        // Initialize VaultStore
        vaultStore = VaultStore.getInstance(
            net.aliasvault.app.vaultstore.keystoreprovider.AndroidKeystoreProvider(this) { null },
            net.aliasvault.app.vaultstore.storageprovider.AndroidStorageProvider(this),
        )

        // Get PIN length
        pinLength = vaultStore.getPinLength()

        // Initialize views
        setupViews()
        setupNumpad()
    }

    private fun setupViews() {
        pinDotsContainer = findViewById(R.id.pinDotsContainer)
        pinTextView = findViewById(R.id.pinTextView)
        errorTextView = findViewById(R.id.errorTextView)
        loadingOverlay = findViewById(R.id.loadingOverlay)
        progressBar = findViewById(R.id.progressBar)

        // Cancel button
        findViewById<Button>(R.id.cancelButton).setOnClickListener {
            setResult(RESULT_CANCELLED)
            finish()
        }

        // Setup PIN display based on whether we have a fixed length
        if (pinLength != null) {
            // Show dots for fixed length PIN
            pinDotsContainer.visibility = View.VISIBLE
            pinTextView.visibility = View.GONE
            createPinDots(pinLength!!)
        } else {
            // Show text for variable length PIN
            pinDotsContainer.visibility = View.GONE
            pinTextView.visibility = View.VISIBLE
            updatePinText()
        }
    }

    private fun createPinDots(count: Int) {
        pinDotsContainer.removeAllViews()
        for (i in 0 until count) {
            val dot = ImageView(this).apply {
                layoutParams = LinearLayout.LayoutParams(
                    resources.getDimensionPixelSize(R.dimen.pin_dot_size),
                    resources.getDimensionPixelSize(R.dimen.pin_dot_size),
                ).apply {
                    marginStart = resources.getDimensionPixelSize(R.dimen.pin_dot_spacing)
                    marginEnd = resources.getDimensionPixelSize(R.dimen.pin_dot_spacing)
                }
                setImageResource(R.drawable.pin_dot_empty)
                tag = i
            }
            pinDotsContainer.addView(dot)
        }
    }

    private fun updatePinDots() {
        for (i in 0 until pinDotsContainer.childCount) {
            val dot = pinDotsContainer.getChildAt(i) as ImageView
            if (i < currentPin.length) {
                dot.setImageResource(R.drawable.pin_dot_filled)
            } else {
                dot.setImageResource(R.drawable.pin_dot_empty)
            }
        }
    }

    private fun updatePinText() {
        pinTextView.text = if (currentPin.isEmpty()) {
            "----"
        } else {
            "•".repeat(currentPin.length)
        }
    }

    private fun setupNumpad() {
        // Number buttons
        findViewById<Button>(R.id.btn1).setOnClickListener { addDigit("1") }
        findViewById<Button>(R.id.btn2).setOnClickListener { addDigit("2") }
        findViewById<Button>(R.id.btn3).setOnClickListener { addDigit("3") }
        findViewById<Button>(R.id.btn4).setOnClickListener { addDigit("4") }
        findViewById<Button>(R.id.btn5).setOnClickListener { addDigit("5") }
        findViewById<Button>(R.id.btn6).setOnClickListener { addDigit("6") }
        findViewById<Button>(R.id.btn7).setOnClickListener { addDigit("7") }
        findViewById<Button>(R.id.btn8).setOnClickListener { addDigit("8") }
        findViewById<Button>(R.id.btn9).setOnClickListener { addDigit("9") }
        findViewById<Button>(R.id.btn0).setOnClickListener { addDigit("0") }

        // Backspace button
        findViewById<Button>(R.id.btnBackspace).setOnClickListener { removeDigit() }
    }

    private fun addDigit(digit: String) {
        if (isUnlocking) return

        // Clear error when user starts typing
        errorTextView.visibility = View.GONE

        // Check if we've reached max length
        pinLength?.let { maxLength ->
            if (currentPin.length >= maxLength) return
        }

        // Add digit
        currentPin += digit

        // Update UI
        if (pinLength != null) {
            updatePinDots()
        } else {
            updatePinText()
        }

        // Auto-submit when PIN reaches expected length
        pinLength?.let { expectedLength ->
            if (currentPin.length == expectedLength) {
                // Small delay to show the last dot filled before attempting unlock
                CoroutineScope(Dispatchers.Main).launch {
                    delay(100)
                    attemptUnlock()
                }
            }
        }
    }

    private fun removeDigit() {
        if (isUnlocking || currentPin.isEmpty()) return

        // Remove last digit
        currentPin = currentPin.dropLast(1)

        // Clear error
        errorTextView.visibility = View.GONE

        // Update UI
        if (pinLength != null) {
            updatePinDots()
        } else {
            updatePinText()
        }
    }

    private fun attemptUnlock() {
        if (isUnlocking) return

        CoroutineScope(Dispatchers.Main).launch {
            try {
                // Show loading state
                isUnlocking = true
                loadingOverlay.visibility = View.VISIBLE
                progressBar.visibility = View.VISIBLE

                // Give UI time to update
                delay(50)

                // Perform unlock in background (Argon2 is CPU intensive)
                val encryptionKeyBase64 = withContext(Dispatchers.IO) {
                    vaultStore.unlockWithPin(currentPin)
                }

                // Success - return encryption key
                val resultIntent = Intent().apply {
                    putExtra(EXTRA_ENCRYPTION_KEY, encryptionKeyBase64)
                }
                setResult(RESULT_SUCCESS, resultIntent)
                finish()
            } catch (e: net.aliasvault.app.vaultstore.PinUnlockException) {
                // Handle PinUnlockException with localized strings
                isUnlocking = false
                loadingOverlay.visibility = View.GONE
                progressBar.visibility = View.GONE

                when (e) {
                    is net.aliasvault.app.vaultstore.PinUnlockException.NotConfigured -> {
                        // PIN not configured - show error briefly then dismiss
                        showError(getString(R.string.pin_not_configured))
                        triggerErrorFeedback()
                        delay(1000)
                        setResult(RESULT_PIN_DISABLED)
                        finish()
                    }
                    is net.aliasvault.app.vaultstore.PinUnlockException.Locked -> {
                        // PIN locked after max attempts - show error briefly then dismiss
                        showError(getString(R.string.pin_locked_max_attempts))
                        triggerErrorFeedback()
                        delay(1000)
                        setResult(RESULT_PIN_DISABLED)
                        finish()
                    }
                    is net.aliasvault.app.vaultstore.PinUnlockException.IncorrectPin -> {
                        // Incorrect PIN - show error with attempts remaining and clear
                        val errorMessage = getString(R.string.pin_incorrect_attempts_remaining, e.attemptsRemaining)
                        showError(errorMessage)
                        triggerErrorFeedback()
                        shakeAndClear()
                    }
                }
            } catch (e: Exception) {
                // Fallback for any other errors
                isUnlocking = false
                loadingOverlay.visibility = View.GONE
                progressBar.visibility = View.GONE

                showError(e.message ?: getString(R.string.pin_unlock_failed))
                triggerErrorFeedback()
                shakeAndClear()
            }
        }
    }

    private fun showError(message: String) {
        errorTextView.text = message
        errorTextView.visibility = View.VISIBLE
    }

    private fun triggerErrorFeedback() {
        // Trigger haptic feedback for error
        val vibrator = getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            vibrator?.vibrate(VibrationEffect.createOneShot(200, VibrationEffect.DEFAULT_AMPLITUDE))
        } else {
            @Suppress("DEPRECATION")
            vibrator?.vibrate(200)
        }
    }

    private fun shakeAndClear() {
        CoroutineScope(Dispatchers.Main).launch {
            // Clear the PIN after a short delay to show error
            delay(500)
            currentPin = ""
            if (pinLength != null) {
                updatePinDots()
            } else {
                updatePinText()
            }
        }
    }

    override fun onBackPressed() {
        // Handle back button as cancel
        setResult(RESULT_CANCELLED)
        super.onBackPressed()
    }
}
