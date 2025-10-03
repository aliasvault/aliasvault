BEGIN TRANSACTION;
CREATE TABLE "Passkeys" (
    "Id" TEXT NOT NULL CONSTRAINT "PK_Passkeys" PRIMARY KEY,
    "CredentialId" TEXT NOT NULL,
    "RpId" TEXT COLLATE NOCASE NOT NULL,
    "UserId" TEXT NULL,
    "PublicKey" TEXT NOT NULL,
    "PrivateKey" TEXT NOT NULL,
    "DisplayName" TEXT NOT NULL,
    "AdditionalData" BLOB NULL,
    "CreatedAt" TEXT NOT NULL,
    "UpdatedAt" TEXT NOT NULL,
    "IsDeleted" INTEGER NOT NULL,
    CONSTRAINT "FK_Passkeys_Credentials_CredentialId" FOREIGN KEY ("CredentialId") REFERENCES "Credentials" ("Id") ON DELETE CASCADE
);

CREATE INDEX "IX_Passkeys_CredentialId" ON "Passkeys" ("CredentialId");

CREATE INDEX "IX_Passkeys_RpId" ON "Passkeys" ("RpId");

INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
VALUES ('20251003045732_1.6.0-AddPasskeys', '9.0.4');

COMMIT;

