package net.aliasvault.app.vaultstore.storageprovider

import android.content.Context
import android.util.Base64
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertFalse
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], manifest = Config.NONE)
class AndroidStorageProviderTest {
    private lateinit var context: Context
    private lateinit var provider: AndroidStorageProvider
    private val vaultBytes = byteArrayOf(0, 1, 2, 3, -1, -2, 42)

    @Before
    fun setup() {
        context = ApplicationProvider.getApplicationContext()
        context.filesDir.listFiles()?.forEach { it.delete() }
        provider = AndroidStorageProvider(context)
    }

    @Test
    fun legacyBase64VaultFileIsConvertedToBytesOnFirstRead() {
        val legacy = File(context.filesDir, "encrypted_database.db")
        legacy.writeText(Base64.encodeToString(vaultBytes, Base64.NO_WRAP))

        assertArrayEquals(vaultBytes, provider.getEncryptedDatabaseFile().readBytes())
        assertFalse(legacy.exists())
    }

    @Test
    fun storedVaultRoundTripsAsBytes() {
        provider.setEncryptedDatabaseFile(vaultBytes)

        assertArrayEquals(vaultBytes, provider.getEncryptedDatabaseFile().readBytes())
    }

    @Test
    fun clearStorageRemovesBothVaultFiles() {
        provider.setEncryptedDatabaseFile(vaultBytes)
        File(context.filesDir, "encrypted_database.db").writeText("AAAA")

        provider.clearStorage()

        assertFalse(File(context.filesDir, "encrypted_database.bin").exists())
        assertFalse(File(context.filesDir, "encrypted_database.db").exists())
    }
}
