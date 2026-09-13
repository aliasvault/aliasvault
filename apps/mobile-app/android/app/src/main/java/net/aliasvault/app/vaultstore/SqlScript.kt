package net.aliasvault.app.vaultstore

/**
 * Splits a multi-statement SQL script into the statements Android's SQLite API can run one at a time.
 */
object SqlScript {
    /**
     * Split a script on semicolons, keeping a trigger body (`CREATE TRIGGER ... END`) whole. Strips out all comments which could be mistaken for statements.
     */
    fun splitStatements(script: String): List<String> {
        val withoutComments = script.trimStart('﻿').lineSequence().filterNot { it.trimStart().startsWith("--") }.joinToString("\n")
        val statements = mutableListOf<String>()
        val trigger = StringBuilder()
        val chunks = withoutComments.split(";").map { it.trim().trimStart('﻿') }
        for (chunk in chunks.filter { it.isNotEmpty() }) {
            if (trigger.isNotEmpty()) {
                trigger.append(chunk).append(";")
                if (chunk.uppercase() == "END") {
                    statements.add(trigger.toString())
                    trigger.clear()
                }
            } else if (chunk.uppercase().contains("CREATE TRIGGER")) {
                trigger.append(chunk).append(";")
            } else {
                statements.add(chunk)
            }
        }
        return statements
    }
}
