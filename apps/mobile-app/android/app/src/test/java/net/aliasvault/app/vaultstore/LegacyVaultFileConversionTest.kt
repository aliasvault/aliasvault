package net.aliasvault.app.vaultstore

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.util.Base64

class LegacyVaultFileConversionTest {
    @get:Rule
    val tempFolder = TemporaryFolder()

    private val vaultBytes = byteArrayOf(0, 1, 2, 3, -1, -2, 42)
    private lateinit var filesDir: File
    private lateinit var vaultFile: File
    private lateinit var legacyFile: File
    private var stored: ByteArray? = null

    @Before
    fun setup() {
        filesDir = tempFolder.root
        vaultFile = File(filesDir, "encrypted_database.bin")
        legacyFile = File(filesDir, LegacyVaultFileConversion.LEGACY_BASE64_DATABASE_FILE)
        stored = null
    }

    @Test
    fun legacyBase64FileIsConvertedAndDeleted() {
        legacyFile.writeText(Base64.getEncoder().encodeToString(vaultBytes))

        convert()

        assertArrayEquals(vaultBytes, stored)
        assertFalse(legacyFile.exists())
    }

    @Test
    fun legacyBase64FileWithLineBreaksIsConverted() {
        legacyFile.writeText(Base64.getMimeEncoder().encodeToString(ByteArray(200) { it.toByte() }) + "\n")

        convert()

        assertArrayEquals(ByteArray(200) { it.toByte() }, stored)
    }

    @Test
    fun existingVaultFileLeavesLegacyFileAlone() {
        vaultFile.writeBytes(vaultBytes)
        legacyFile.writeText("AAAA")

        convert()

        assertNull(stored)
        assertTrue(legacyFile.exists())
    }

    @Test
    fun undecodableLegacyFileIsDropped() {
        legacyFile.writeText("A")

        convert()

        assertNull(stored)
        assertFalse(legacyFile.exists())
    }

    @Test
    fun failedWriteKeepsLegacyFileForTheNextRead() {
        legacyFile.writeText(Base64.getEncoder().encodeToString(vaultBytes))

        val error = runCatching { LegacyVaultFileConversion.convertLegacyBase64Database(filesDir, vaultFile) { error("disk full") } }.exceptionOrNull()

        assertEquals("disk full", error?.message)
        assertTrue(legacyFile.exists())
    }

    private fun convert() = LegacyVaultFileConversion.convertLegacyBase64Database(filesDir, vaultFile) { stored = it }
}
