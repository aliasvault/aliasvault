package net.aliasvault.app.autofill.utils

import android.content.Intent
import android.os.Build
import android.view.autofill.AutofillId
import net.aliasvault.app.autofill.models.FieldType

/**
 * Passes the target form fields to the activities that autofill rows open.
 */
object AutofillFieldExtras {

    /**
     * Store [fields] in [intent]: the `AutofillId`s under [idsKey], their `FieldType` ordinals under [typesKey].
     */
    fun put(intent: Intent, fields: List<Pair<AutofillId, FieldType>>, idsKey: String, typesKey: String) {
        intent.putExtra(idsKey, fields.map { it.first }.toTypedArray())
        intent.putExtra(typesKey, IntArray(fields.size) { i -> fields[i].second.ordinal })
    }

    /**
     * The fields stored by [put], or null when an extra is missing or the two do not line up.
     */
    fun read(intent: Intent, idsKey: String, typesKey: String): List<Pair<AutofillId, FieldType>>? {
        val ids = readIds(intent, idsKey) ?: return null
        val ordinals = intent.getIntArrayExtra(typesKey) ?: return null
        if (ids.size != ordinals.size) {
            return null
        }
        val types = FieldType.values()
        return ids.mapIndexed { i, id -> id to (types.getOrNull(ordinals[i]) ?: FieldType.UNKNOWN) }
    }

    @Suppress("DEPRECATION")
    private fun readIds(intent: Intent, key: String): Array<AutofillId>? {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.getParcelableArrayExtra(key, AutofillId::class.java)
        } else {
            intent.getParcelableArrayExtra(key)?.mapNotNull { it as? AutofillId }?.toTypedArray()
        }
    }
}
