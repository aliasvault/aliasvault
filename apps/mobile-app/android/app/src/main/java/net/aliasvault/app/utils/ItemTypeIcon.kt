package net.aliasvault.app.utils

import android.content.Context
import android.content.res.Resources
import android.graphics.Bitmap
import android.graphics.Canvas
import android.util.Log
import com.caverock.androidsvg.SVG
import net.aliasvault.app.vaultstore.models.ItemTypeIcons

/**
 * Item type icon helper - provides bitmap-based icons for different item types.
 * Uses SVG definitions from the auto-generated ItemTypeIcons.
 */
object ItemTypeIcon {
    private const val TAG = "ItemTypeIcon"
    private const val DEFAULT_SIZE_DP = 24
    private const val RENDER_SCALE_FACTOR = 4

    /**
     * Item type enumeration matching the database model.
     */
    object ItemType {
        /** Login item type constant. */
        const val LOGIN = "Login"

        /** Alias item type constant. */
        const val ALIAS = "Alias"

        /** Credit card item type constant. */
        const val CREDIT_CARD = "CreditCard"

        /** Note item type constant. */
        const val NOTE = "Note"
    }

    /**
     * Credit card brand type.
     */
    enum class CardBrand {
        VISA,
        MASTERCARD,
        AMEX,
        DISCOVER,
        GENERIC,
        ;

        companion object {
            /**
             * Detect credit card brand from card number using industry-standard prefixes.
             *
             * @param cardNumber The card number to detect brand from.
             * @return The detected card brand.
             */
            fun detect(cardNumber: String?): CardBrand {
                if (cardNumber.isNullOrEmpty()) {
                    return GENERIC
                }

                // Remove spaces and dashes
                val cleaned = cardNumber.replace(Regex("[\\s-]"), "")

                // Must be mostly numeric
                if (!cleaned.matches(Regex("^\\d{4,}.*"))) {
                    return GENERIC
                }

                // Visa: starts with 4
                if (cleaned.matches(Regex("^4.*"))) {
                    return VISA
                }

                // Mastercard: starts with 51-55 or 2221-2720
                if (cleaned.matches(Regex("^5[1-5].*")) || cleaned.matches(Regex("^2[2-7].*"))) {
                    return MASTERCARD
                }

                // Amex: starts with 34 or 37
                if (cleaned.matches(Regex("^3[47].*"))) {
                    return AMEX
                }

                // Discover: starts with 6011, 622, 644-649, 65
                if (cleaned.matches(Regex("^6(?:011|22|4[4-9]|5).*"))) {
                    return DISCOVER
                }

                return GENERIC
            }
        }
    }

    /**
     * Get the appropriate icon bitmap for an item type.
     *
     * @param context Android context.
     * @param itemType The item type (Login, Alias, CreditCard, Note).
     * @param cardNumber Optional card number for credit card brand detection.
     * @param size Icon size in pixels (default uses density-aware sizing).
     * @return Bitmap icon.
     */
    @Suppress("UNUSED_PARAMETER") // Context reserved for future use (loading drawable resources)
    fun getIcon(
        context: Context,
        itemType: String,
        cardNumber: String? = null,
        size: Int? = null,
    ): Bitmap {
        val svgString = when (itemType) {
            ItemType.NOTE -> ItemTypeIcons.NOTE
            ItemType.CREDIT_CARD -> {
                val brand = CardBrand.detect(cardNumber)
                getCardSvg(brand)
            }
            ItemType.LOGIN, ItemType.ALIAS -> ItemTypeIcons.PLACEHOLDER
            else -> ItemTypeIcons.PLACEHOLDER
        }

        return svgToBitmap(svgString, size) ?: createFallbackBitmap(size)
    }

    /**
     * Get the appropriate icon for a credit card brand.
     *
     * @param brand The credit card brand.
     * @param size Icon size in pixels (default uses density-aware sizing).
     * @return Bitmap icon.
     */
    fun getCardIcon(brand: CardBrand, size: Int? = null): Bitmap {
        val svgString = getCardSvg(brand)
        return svgToBitmap(svgString, size) ?: createFallbackBitmap(size)
    }

    /**
     * Get the SVG string for a credit card brand.
     *
     * @param brand The credit card brand.
     * @return SVG string.
     */
    private fun getCardSvg(brand: CardBrand): String {
        return when (brand) {
            CardBrand.VISA -> ItemTypeIcons.VISA
            CardBrand.MASTERCARD -> ItemTypeIcons.MASTERCARD
            CardBrand.AMEX -> ItemTypeIcons.AMEX
            CardBrand.DISCOVER -> ItemTypeIcons.DISCOVER
            CardBrand.GENERIC -> ItemTypeIcons.CREDIT_CARD
        }
    }

    /**
     * Convert SVG string to a bitmap.
     *
     * @param svgString The SVG string to render.
     * @param size Optional target size in pixels.
     * @return The rendered bitmap, or null on error.
     */
    private fun svgToBitmap(svgString: String, size: Int?): Bitmap? {
        return try {
            val svg = SVG.getFromString(svgString)

            // Use provided size or calculate from density
            val targetSizePx = size ?: run {
                val density = Resources.getSystem().displayMetrics.density
                (DEFAULT_SIZE_DP * density).toInt()
            }
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
     * Create a simple fallback bitmap when SVG rendering fails.
     *
     * @param size Optional target size in pixels.
     * @return A simple colored bitmap.
     */
    private fun createFallbackBitmap(size: Int?): Bitmap {
        val targetSizePx = size ?: run {
            val density = Resources.getSystem().displayMetrics.density
            (DEFAULT_SIZE_DP * density).toInt()
        }
        return Bitmap.createBitmap(targetSizePx, targetSizePx, Bitmap.Config.ARGB_8888)
    }
}
