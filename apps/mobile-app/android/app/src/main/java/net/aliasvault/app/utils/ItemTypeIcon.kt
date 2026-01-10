package net.aliasvault.app.utils

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Typeface

/**
 * Item type icon helper - provides bitmap-based icons for different item types.
 * Matches the design from browser extension and iOS implementations.
 */
object ItemTypeIcon {

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

    // AliasVault color scheme
    private const val COLOR_PRIMARY = "#f49541"
    private const val COLOR_DARK = "#d68338"
    private const val COLOR_LIGHT = "#ffe096"
    private const val COLOR_LIGHTER = "#fbcb74"

    /**
     * Get the appropriate icon bitmap for an item type.
     *
     * @param context Android context.
     * @param itemType The item type (Login, Alias, CreditCard, Note).
     * @param cardNumber Optional card number for credit card brand detection.
     * @param size Icon size in pixels (default 96).
     * @return Bitmap icon.
     */
    @Suppress("UNUSED_PARAMETER") // Context reserved for future use (loading drawable resources)
    fun getIcon(
        context: Context,
        itemType: String,
        cardNumber: String? = null,
        size: Int = 96,
    ): Bitmap {
        return when (itemType) {
            ItemType.NOTE -> createNoteIcon(size)
            ItemType.CREDIT_CARD -> {
                val brand = CardBrand.detect(cardNumber)
                getCardIcon(brand, size)
            }
            ItemType.LOGIN, ItemType.ALIAS -> createPlaceholderIcon(size)
            else -> createPlaceholderIcon(size)
        }
    }

    /**
     * Get the appropriate icon for a credit card brand.
     *
     * @param brand The credit card brand.
     * @param size Icon size in pixels (default 96).
     * @return Bitmap icon.
     */
    fun getCardIcon(brand: CardBrand, size: Int = 96): Bitmap {
        return when (brand) {
            CardBrand.VISA -> createVisaIcon(size)
            CardBrand.MASTERCARD -> createMastercardIcon(size)
            CardBrand.AMEX -> createAmexIcon(size)
            CardBrand.DISCOVER -> createDiscoverIcon(size)
            CardBrand.GENERIC -> createCreditCardIcon(size)
        }
    }

    /**
     * Create generic credit card icon.
     *
     * @param size Icon size in pixels.
     * @return Bitmap icon.
     */
    private fun createCreditCardIcon(size: Int): Bitmap {
        val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)

        val scale = size / 32f

        // Card background
        paint.color = Color.parseColor(COLOR_PRIMARY)
        canvas.drawRoundRect(
            RectF(2 * scale, 6 * scale, 30 * scale, 26 * scale),
            3 * scale,
            3 * scale,
            paint,
        )

        // Magnetic stripe
        paint.color = Color.parseColor(COLOR_DARK)
        canvas.drawRect(2 * scale, 11 * scale, 30 * scale, 15 * scale, paint)

        // Chip
        paint.color = Color.parseColor(COLOR_LIGHT)
        canvas.drawRoundRect(
            RectF(5 * scale, 18 * scale, 13 * scale, 20 * scale),
            1 * scale,
            1 * scale,
            paint,
        )

        // Number line
        paint.color = Color.parseColor(COLOR_LIGHTER)
        canvas.drawRoundRect(
            RectF(5 * scale, 22 * scale, 10 * scale, 23.5f * scale),
            0.75f * scale,
            0.75f * scale,
            paint,
        )

        return bitmap
    }

    /**
     * Create Visa icon.
     *
     * @param size Icon size in pixels.
     * @return Bitmap icon.
     */
    private fun createVisaIcon(size: Int): Bitmap {
        val bitmap = createCreditCardIcon(size)
        val canvas = Canvas(bitmap)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        paint.color = Color.parseColor(COLOR_LIGHT)
        paint.textSize = 6 * (size / 32f)
        paint.typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)

        canvas.drawText("VISA", 8 * (size / 32f), 18 * (size / 32f), paint)

        return bitmap
    }

    /**
     * Create Mastercard icon.
     *
     * @param size Icon size in pixels.
     * @return Bitmap icon.
     */
    private fun createMastercardIcon(size: Int): Bitmap {
        val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)

        val scale = size / 32f

        // Card background
        paint.color = Color.parseColor(COLOR_PRIMARY)
        canvas.drawRoundRect(
            RectF(2 * scale, 6 * scale, 30 * scale, 26 * scale),
            3 * scale,
            3 * scale,
            paint,
        )

        // Left circle
        paint.color = Color.parseColor(COLOR_DARK)
        canvas.drawCircle(13 * scale, 16 * scale, 5 * scale, paint)

        // Right circle
        paint.color = Color.parseColor(COLOR_LIGHT)
        canvas.drawCircle(19 * scale, 16 * scale, 5 * scale, paint)

        // Overlap (simplified)
        paint.color = Color.parseColor(COLOR_LIGHTER)
        val path = Path()
        path.addCircle(16 * scale, 16 * scale, 3.5f * scale, Path.Direction.CW)
        canvas.drawPath(path, paint)

        return bitmap
    }

    /**
     * Create Amex icon.
     *
     * @param size Icon size in pixels.
     * @return Bitmap icon.
     */
    private fun createAmexIcon(size: Int): Bitmap {
        val bitmap = createCreditCardIcon(size)
        val canvas = Canvas(bitmap)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        paint.color = Color.parseColor(COLOR_LIGHT)
        paint.textSize = 8 * (size / 32f)
        paint.typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
        paint.textAlign = Paint.Align.CENTER

        canvas.drawText("AMEX", 16 * (size / 32f), 18 * (size / 32f), paint)

        return bitmap
    }

    /**
     * Create Discover icon.
     *
     * @param size Icon size in pixels.
     * @return Bitmap icon.
     */
    private fun createDiscoverIcon(size: Int): Bitmap {
        val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)

        val scale = size / 32f

        // Card background
        paint.color = Color.parseColor(COLOR_PRIMARY)
        canvas.drawRoundRect(
            RectF(2 * scale, 6 * scale, 30 * scale, 26 * scale),
            3 * scale,
            3 * scale,
            paint,
        )

        // Circle logo
        paint.color = Color.parseColor(COLOR_LIGHT)
        canvas.drawCircle(20 * scale, 16 * scale, 4 * scale, paint)

        // "DI" text
        paint.textSize = 6 * scale
        paint.typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
        canvas.drawText("D", 7 * scale, 17 * scale, paint)

        return bitmap
    }

    /**
     * Create note/document icon.
     *
     * @param size Icon size in pixels.
     * @return Bitmap icon.
     */
    private fun createNoteIcon(size: Int): Bitmap {
        val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)

        val scale = size / 32f

        // Document body
        paint.color = Color.parseColor(COLOR_PRIMARY)
        val path = Path()
        path.moveTo(8 * scale, 4 * scale)
        path.lineTo(19 * scale, 4 * scale)
        path.lineTo(26 * scale, 11 * scale)
        path.lineTo(26 * scale, 26 * scale)
        path.lineTo(8 * scale, 26 * scale)
        path.close()
        canvas.drawPath(path, paint)

        // Folded corner
        paint.color = Color.parseColor(COLOR_DARK)
        val cornerPath = Path()
        cornerPath.moveTo(19 * scale, 4 * scale)
        cornerPath.lineTo(19 * scale, 11 * scale)
        cornerPath.lineTo(26 * scale, 11 * scale)
        cornerPath.close()
        canvas.drawPath(cornerPath, paint)

        // Text lines
        paint.color = Color.parseColor(COLOR_LIGHT)
        canvas.drawRoundRect(
            RectF(10 * scale, 14 * scale, 22 * scale, 15.5f * scale),
            0.75f * scale,
            0.75f * scale,
            paint,
        )
        canvas.drawRoundRect(
            RectF(10 * scale, 18 * scale, 20 * scale, 19.5f * scale),
            0.75f * scale,
            0.75f * scale,
            paint,
        )
        canvas.drawRoundRect(
            RectF(10 * scale, 22 * scale, 18 * scale, 23.5f * scale),
            0.75f * scale,
            0.75f * scale,
            paint,
        )

        return bitmap
    }

    /**
     * Create placeholder key icon for Login/Alias.
     *
     * @param size Icon size in pixels.
     * @return Bitmap icon.
     */
    private fun createPlaceholderIcon(size: Int): Bitmap {
        val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        paint.color = Color.parseColor(COLOR_PRIMARY)
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = 2.5f * (size / 32f)
        paint.strokeCap = Paint.Cap.ROUND

        val scale = size / 32f

        // Key bow (circular head)
        canvas.drawCircle(10 * scale, 10 * scale, 6.5f * scale, paint)

        // Key hole in bow
        paint.strokeWidth = 2 * scale
        canvas.drawCircle(10 * scale, 10 * scale, 2.5f * scale, paint)

        // Key shaft - diagonal
        paint.strokeWidth = 2.5f * scale
        canvas.drawLine(15 * scale, 15 * scale, 27 * scale, 27 * scale, paint)

        // Key teeth - perpendicular to shaft
        canvas.drawLine(19 * scale, 19 * scale, 23 * scale, 15 * scale, paint)
        canvas.drawLine(24 * scale, 24 * scale, 28 * scale, 20 * scale, paint)

        return bitmap
    }
}
