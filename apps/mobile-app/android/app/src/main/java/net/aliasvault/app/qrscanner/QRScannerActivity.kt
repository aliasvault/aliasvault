package net.aliasvault.app.qrscanner

import android.animation.ObjectAnimator
import android.app.Activity
import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.WindowInsets
import android.widget.FrameLayout
import android.widget.ImageButton
import com.google.zxing.ResultPoint
import com.journeyapps.barcodescanner.BarcodeCallback
import com.journeyapps.barcodescanner.BarcodeResult
import com.journeyapps.barcodescanner.CaptureManager
import com.journeyapps.barcodescanner.DecoratedBarcodeView
import net.aliasvault.app.R

/**
 * Activity for scanning QR codes using ZXing.
 */
class QRScannerActivity : Activity() {
    private lateinit var barcodeView: DecoratedBarcodeView
    private lateinit var capture: CaptureManager
    private var hasScanned = false
    private var prefixes: List<String>? = null

    companion object {
        /** Intent extra key for prefixes. */
        const val EXTRA_PREFIXES = "EXTRA_PREFIXES"

        /** Intent extra key for status text. */
        const val EXTRA_STATUS_TEXT = "EXTRA_STATUS_TEXT"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Get prefixes from intent if provided
        prefixes = intent.getStringArrayListExtra(EXTRA_PREFIXES)

        // Get status text from intent, default to "Scan QR code" if not provided
        val statusText = intent.getStringExtra(EXTRA_STATUS_TEXT)?.takeIf { it.isNotEmpty() } ?: "Scan QR code"

        // Create and configure barcode view
        barcodeView = DecoratedBarcodeView(this)
        barcodeView.setStatusText(statusText)

        val root = FrameLayout(this)
        root.addView(barcodeView, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        root.addView(createCloseButton())
        setContentView(root)

        // Initialize capture manager
        capture = CaptureManager(this, barcodeView)
        capture.initializeFromIntent(intent, savedInstanceState)

        // Set custom callback to add visual feedback
        barcodeView.decodeContinuous(object : BarcodeCallback {
            override fun barcodeResult(result: BarcodeResult?) {
                if (result != null && !hasScanned) {
                    val scannedText = result.text

                    // Check if prefixes filter is enabled
                    if (prefixes != null && prefixes!!.isNotEmpty()) {
                        // Check if the scanned code starts with any of the accepted prefixes
                        val hasValidPrefix = prefixes!!.any { prefix ->
                            scannedText.startsWith(prefix)
                        }

                        if (!hasValidPrefix) {
                            // Invalid QR code - continue scanning without setting hasScanned
                            // Note: ZXing library continues scanning automatically
                            return
                        }
                    }

                    // Valid QR code
                    hasScanned = true

                    // Show success animation
                    showScanSuccessAnimation()

                    // Pause scanning
                    barcodeView.pause()

                    // Set result and finish after animation
                    val resultIntent = Intent()
                    resultIntent.putExtra("SCAN_RESULT", scannedText)
                    setResult(RESULT_OK, resultIntent)

                    // Delay finish to allow animation to complete
                    barcodeView.postDelayed({
                        finish()
                    }, 400) // 400ms delay for animation
                }
            }

            override fun possibleResultPoints(resultPoints: List<ResultPoint>) {
                // No visualization needed
            }
        })
    }

    /**
     * Create the close button in the top start corner, kept clear of the system bars.
     */
    private fun createCloseButton(): ImageButton {
        val density = resources.displayMetrics.density
        val size = (48 * density).toInt()
        val margin = (8 * density).toInt()

        val button = ImageButton(this)
        button.setImageResource(R.drawable.ic_ui_x)
        button.imageTintList = ColorStateList.valueOf(Color.WHITE)
        button.contentDescription = getString(R.string.common_cancel)
        val padding = (12 * density).toInt()
        button.setPadding(padding, padding, padding, padding)
        val outValue = android.util.TypedValue()
        theme.resolveAttribute(android.R.attr.selectableItemBackgroundBorderless, outValue, true)
        button.setBackgroundResource(outValue.resourceId)
        button.setOnClickListener {
            setResult(RESULT_CANCELED)
            finish()
        }

        val params = FrameLayout.LayoutParams(size, size, Gravity.TOP or Gravity.START)
        params.setMargins(margin, margin, margin, margin)
        button.layoutParams = params
        button.setOnApplyWindowInsetsListener { view, insets ->
            val bars = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
            val lp = view.layoutParams as FrameLayout.LayoutParams
            lp.topMargin = bars.top + margin
            lp.marginStart = (if (view.layoutDirection == View.LAYOUT_DIRECTION_RTL) bars.right else bars.left) + margin
            view.layoutParams = lp
            insets
        }

        return button
    }

    /**
     * Show a success animation when QR code is scanned.
     */
    private fun showScanSuccessAnimation() {
        // Flash animation - fade viewfinder quickly
        val viewFinder: View? = barcodeView.viewFinder
        if (viewFinder != null) {
            // Create flash effect by animating alpha
            val fadeOut = ObjectAnimator.ofFloat(viewFinder, "alpha", 1f, 0.3f)
            fadeOut.duration = 100

            val fadeIn = ObjectAnimator.ofFloat(viewFinder, "alpha", 0.3f, 1f)
            fadeIn.duration = 100

            fadeOut.start()
            fadeOut.addListener(object : android.animation.AnimatorListenerAdapter() {
                override fun onAnimationEnd(animation: android.animation.Animator) {
                    fadeIn.start()
                }
            })
        }
    }

    override fun onResume() {
        super.onResume()
        capture.onResume()
    }

    override fun onPause() {
        super.onPause()
        capture.onPause()
    }

    override fun onDestroy() {
        super.onDestroy()
        capture.onDestroy()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        capture.onSaveInstanceState(outState)
    }

    @Deprecated("Deprecated in Java")
    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<String>,
        grantResults: IntArray,
    ) {
        capture.onRequestPermissionsResult(requestCode, permissions, grantResults)
    }
}
