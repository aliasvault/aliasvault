package net.aliasvault.app.autofill.utils

import android.content.res.Resources
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.util.Base64
import android.util.Log
import com.caverock.androidsvg.SVG
import java.io.ByteArrayOutputStream

/**
 * Utility class for image operations.
 */
object ImageUtils {
    private const val TAG = "ImageUtils"
    private const val TARGET_SIZE_DP = 24
    private const val RENDER_SCALE_FACTOR = 4

    /**
     * Convert bytes to a bitmap.
     * @param bytes The bytes to convert
     * @return The bitmap
     */
    fun bytesToBitmap(bytes: ByteArray): Bitmap? {
        return try {
            when (detectMimeType(bytes)) {
                "image/svg+xml" -> svgToBitmap(bytes)
                else -> decodeSampledRaster(bytes)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error converting bytes to bitmap", e)
            null
        }
    }

    /**
     * Decode a raster image (PNG/JPEG/ICO) downsampled to roughly the autofill
     * icon size.
     */
    private fun decodeSampledRaster(bytes: ByteArray): Bitmap? {
        val density = Resources.getSystem().displayMetrics.density
        val maxSizePx = (TARGET_SIZE_DP * density).toInt().coerceAtLeast(1)

        // First pass: read the source dimensions without allocating the bitmap.
        val boundsOptions = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, boundsOptions)
        val srcWidth = boundsOptions.outWidth
        val srcHeight = boundsOptions.outHeight
        if (srcWidth <= 0 || srcHeight <= 0) {
            // Bounds unavailable (e.g. some ICO files) - fall back to a plain decode.
            return BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        }

        // Second pass: decode at the largest power-of-two sample that stays at or
        // above the target size, then scale the remainder down precisely.
        var sampleSize = 1
        while (srcWidth / (sampleSize * 2) >= maxSizePx && srcHeight / (sampleSize * 2) >= maxSizePx) {
            sampleSize *= 2
        }
        val decodeOptions = BitmapFactory.Options().apply { inSampleSize = sampleSize }
        val decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, decodeOptions) ?: return null

        val largestDim = maxOf(decoded.width, decoded.height)
        if (largestDim <= maxSizePx) {
            return decoded
        }
        val scale = maxSizePx.toFloat() / largestDim
        val scaledWidth = (decoded.width * scale).toInt().coerceAtLeast(1)
        val scaledHeight = (decoded.height * scale).toInt().coerceAtLeast(1)
        val scaled = Bitmap.createScaledBitmap(decoded, scaledWidth, scaledHeight, true)
        if (scaled != decoded) {
            decoded.recycle()
        }
        return scaled
    }

    /**
     * Detect the mime type of the bytes.
     * @param bytes The bytes to detect the mime type of
     * @return The mime type
     */
    private fun detectMimeType(bytes: ByteArray): String {
        // SVG heuristic
        if (bytes.size >= 5) {
            val header = String(bytes, 0, 5).lowercase()
            if (header.contains("<?xml") || header.contains("<svg")) {
                return "image/svg+xml"
            }
        }
        // PNG
        if (bytes.size >= 4 &&
            bytes[0] == 0x89.toByte() &&
            bytes[1] == 0x50.toByte() &&
            bytes[2] == 0x4E.toByte() &&
            bytes[3] == 0x47.toByte()
        ) {
            return "image/png"
        }
        // ICO
        if (bytes.size >= 4 &&
            bytes[0] == 0x00.toByte() &&
            bytes[1] == 0x00.toByte() &&
            bytes[2] == 0x01.toByte() &&
            bytes[3] == 0x00.toByte()
        ) {
            return "image/x-icon"
        }
        return "image/x-icon"
    }

    /**
     * Convert SVG bytes to a bitmap.
     * @param bytes The bytes to convert
     * @return The bitmap
     */
    private fun svgToBitmap(bytes: ByteArray): Bitmap? {
        return try {
            val svg = SVG.getFromString(String(bytes, Charsets.UTF_8))

            // Convert dp to pixels based on screen density
            val density = Resources.getSystem().displayMetrics.density
            val targetSizePx = (TARGET_SIZE_DP * density).toInt()
            val renderSize = targetSizePx * RENDER_SCALE_FACTOR

            svg.setDocumentWidth(renderSize.toFloat())
            svg.setDocumentHeight(renderSize.toFloat())

            // Create bitmap & canvas at larger size
            val largeBitmap = Bitmap.createBitmap(renderSize, renderSize, Bitmap.Config.ARGB_8888)
            val canvas = Canvas(largeBitmap)
            svg.renderToCanvas(canvas)

            // Scale down to target size with better quality
            Bitmap.createScaledBitmap(largeBitmap, targetSizePx, targetSizePx, true)
        } catch (e: Exception) {
            Log.e(TAG, "Error rendering SVG to bitmap", e)
            null
        }
    }

    /**
     * Convert a bitmap to bytes.
     * @param bitmap The bitmap to convert
     * @return The bytes
     */
    fun bitmapToBytes(bitmap: Bitmap): ByteArray {
        return ByteArrayOutputStream().use { stream ->
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream)
            stream.toByteArray()
        }
    }

    /**
     * Convert a base64 string to bytes.
     * @param base64 The base64 string to convert
     * @return The bytes
     */
    fun base64ToBytes(base64: String): ByteArray {
        return Base64.decode(base64, Base64.DEFAULT)
    }
}
