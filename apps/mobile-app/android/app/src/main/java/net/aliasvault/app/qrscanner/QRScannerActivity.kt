package net.aliasvault.app.qrscanner

import android.animation.ObjectAnimator
import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.view.View
import com.google.zxing.ResultPoint
import com.journeyapps.barcodescanner.BarcodeCallback
import com.journeyapps.barcodescanner.BarcodeResult
import com.journeyapps.barcodescanner.CaptureManager
import com.journeyapps.barcodescanner.DecoratedBarcodeView

/**
 * Activity for scanning QR codes using ZXing.
 */
class QRScannerActivity : Activity() {
    private lateinit var barcodeView: DecoratedBarcodeView
    private lateinit var capture: CaptureManager
    private var hasScanned = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Create and configure barcode view
        barcodeView = DecoratedBarcodeView(this)
        barcodeView.setStatusText("Scan AliasVault QR Code")
        setContentView(barcodeView)

        // Initialize capture manager
        capture = CaptureManager(this, barcodeView)
        capture.initializeFromIntent(intent, savedInstanceState)

        // Set custom callback to add visual feedback
        barcodeView.decodeContinuous(object : BarcodeCallback {
            override fun barcodeResult(result: BarcodeResult?) {
                if (result != null && !hasScanned) {
                    hasScanned = true

                    // Show success animation
                    showScanSuccessAnimation()

                    // Pause scanning
                    barcodeView.pause()

                    // Set result and finish after animation
                    val resultIntent = Intent()
                    resultIntent.putExtra("SCAN_RESULT", result.text)
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
