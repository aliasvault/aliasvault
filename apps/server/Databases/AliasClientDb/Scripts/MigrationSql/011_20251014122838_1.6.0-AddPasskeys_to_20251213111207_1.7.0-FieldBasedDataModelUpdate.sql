BEGIN TRANSACTION;
ALTER TABLE "TotpCodes" RENAME COLUMN "CredentialId" TO "ItemId";

DROP INDEX IF EXISTS "IX_TotpCodes_CredentialId";

CREATE INDEX IF NOT EXISTS "IX_TotpCodes_ItemId" ON "TotpCodes" ("ItemId");

ALTER TABLE "Passkeys" RENAME COLUMN "CredentialId" TO "ItemId";

DROP INDEX IF EXISTS "IX_Passkeys_CredentialId";

CREATE INDEX IF NOT EXISTS "IX_Passkeys_ItemId" ON "Passkeys" ("ItemId");

ALTER TABLE "Attachments" RENAME COLUMN "CredentialId" TO "ItemId";

DROP INDEX IF EXISTS "IX_Attachments_CredentialId";

CREATE INDEX IF NOT EXISTS "IX_Attachments_ItemId" ON "Attachments" ("ItemId");

CREATE TABLE "FieldDefinitions" (
    "Id" TEXT NOT NULL CONSTRAINT "PK_FieldDefinitions" PRIMARY KEY,
    "FieldType" TEXT NOT NULL,
    "Label" TEXT NOT NULL,
    "IsMultiValue" INTEGER NOT NULL,
    "IsHidden" INTEGER NOT NULL,
    "EnableHistory" INTEGER NOT NULL,
    "Weight" INTEGER NOT NULL,
    "ApplicableToTypes" TEXT NULL,
    "CreatedAt" TEXT NOT NULL,
    "UpdatedAt" TEXT NOT NULL,
    "IsDeleted" INTEGER NOT NULL
);

CREATE TABLE "Folders" (
    "Id" TEXT NOT NULL CONSTRAINT "PK_Folders" PRIMARY KEY,
    "Name" TEXT NOT NULL,
    "ParentFolderId" TEXT NULL,
    "Weight" INTEGER NOT NULL,
    "CreatedAt" TEXT NOT NULL,
    "UpdatedAt" TEXT NOT NULL,
    "IsDeleted" INTEGER NOT NULL,
    CONSTRAINT "FK_Folders_Folders_ParentFolderId" FOREIGN KEY ("ParentFolderId") REFERENCES "Folders" ("Id") ON DELETE CASCADE
);

CREATE TABLE "Logos" (
    "Id" TEXT NOT NULL CONSTRAINT "PK_Logos" PRIMARY KEY,
    "Source" TEXT NOT NULL,
    "FileData" BLOB NULL,
    "MimeType" TEXT NULL,
    "FetchedAt" TEXT NULL,
    "CreatedAt" TEXT NOT NULL,
    "UpdatedAt" TEXT NOT NULL,
    "IsDeleted" INTEGER NOT NULL
);

CREATE TABLE "Tags" (
    "Id" TEXT NOT NULL CONSTRAINT "PK_Tags" PRIMARY KEY,
    "Name" TEXT NOT NULL,
    "Color" TEXT NULL,
    "DisplayOrder" INTEGER NOT NULL,
    "CreatedAt" TEXT NOT NULL,
    "UpdatedAt" TEXT NOT NULL,
    "IsDeleted" INTEGER NOT NULL
);

CREATE TABLE "Items" (
    "Id" TEXT NOT NULL CONSTRAINT "PK_Items" PRIMARY KEY,
    "Name" TEXT NULL,
    "ItemType" TEXT NOT NULL,
    "LogoId" TEXT NULL,
    "DeletedAt" TEXT NULL,
    "FolderId" TEXT NULL,
    "CreatedAt" TEXT NOT NULL,
    "UpdatedAt" TEXT NOT NULL,
    "IsDeleted" INTEGER NOT NULL,
    CONSTRAINT "FK_Items_Folders_FolderId" FOREIGN KEY ("FolderId") REFERENCES "Folders" ("Id") ON DELETE SET NULL,
    CONSTRAINT "FK_Items_Logos_LogoId" FOREIGN KEY ("LogoId") REFERENCES "Logos" ("Id") ON DELETE SET NULL
);

CREATE TABLE "FieldHistories" (
    "Id" TEXT NOT NULL CONSTRAINT "PK_FieldHistories" PRIMARY KEY,
    "ItemId" TEXT NOT NULL,
    "FieldDefinitionId" TEXT NULL,
    "FieldKey" TEXT NULL,
    "ValueSnapshot" TEXT NOT NULL,
    "ChangedAt" TEXT NOT NULL,
    "CreatedAt" TEXT NOT NULL,
    "UpdatedAt" TEXT NOT NULL,
    "IsDeleted" INTEGER NOT NULL,
    CONSTRAINT "FK_FieldHistories_FieldDefinitions_FieldDefinitionId" FOREIGN KEY ("FieldDefinitionId") REFERENCES "FieldDefinitions" ("Id") ON DELETE CASCADE,
    CONSTRAINT "FK_FieldHistories_Items_ItemId" FOREIGN KEY ("ItemId") REFERENCES "Items" ("Id") ON DELETE CASCADE
);

CREATE TABLE "FieldValues" (
    "Id" TEXT NOT NULL CONSTRAINT "PK_FieldValues" PRIMARY KEY,
    "ItemId" TEXT NOT NULL,
    "FieldDefinitionId" TEXT NULL,
    "FieldKey" TEXT NULL,
    "Value" TEXT NULL,
    "Weight" INTEGER NOT NULL,
    "CreatedAt" TEXT NOT NULL,
    "UpdatedAt" TEXT NOT NULL,
    "IsDeleted" INTEGER NOT NULL,
    CONSTRAINT "FK_FieldValues_FieldDefinitions_FieldDefinitionId" FOREIGN KEY ("FieldDefinitionId") REFERENCES "FieldDefinitions" ("Id") ON DELETE CASCADE,
    CONSTRAINT "FK_FieldValues_Items_ItemId" FOREIGN KEY ("ItemId") REFERENCES "Items" ("Id") ON DELETE CASCADE
);

CREATE TABLE "ItemTags" (
    "Id" TEXT NOT NULL CONSTRAINT "PK_ItemTags" PRIMARY KEY,
    "ItemId" TEXT NOT NULL,
    "TagId" TEXT NOT NULL,
    "CreatedAt" TEXT NOT NULL,
    "UpdatedAt" TEXT NOT NULL,
    "IsDeleted" INTEGER NOT NULL,
    CONSTRAINT "FK_ItemTags_Items_ItemId" FOREIGN KEY ("ItemId") REFERENCES "Items" ("Id") ON DELETE CASCADE,
    CONSTRAINT "FK_ItemTags_Tags_TagId" FOREIGN KEY ("TagId") REFERENCES "Tags" ("Id") ON DELETE CASCADE
);

CREATE INDEX "IX_FieldHistories_FieldDefinitionId" ON "FieldHistories" ("FieldDefinitionId");

CREATE INDEX "IX_FieldHistories_ItemId" ON "FieldHistories" ("ItemId");

CREATE INDEX "IX_FieldValues_FieldDefinitionId" ON "FieldValues" ("FieldDefinitionId");

CREATE INDEX "IX_FieldValues_FieldKey" ON "FieldValues" ("FieldKey");

CREATE INDEX "IX_FieldValues_ItemId" ON "FieldValues" ("ItemId");

CREATE INDEX "IX_FieldValues_ItemId_FieldDefinitionId_Weight" ON "FieldValues" ("ItemId", "FieldDefinitionId", "Weight");

CREATE INDEX "IX_FieldValues_ItemId_FieldKey" ON "FieldValues" ("ItemId", "FieldKey");

CREATE INDEX "IX_Folders_ParentFolderId" ON "Folders" ("ParentFolderId");

CREATE INDEX "IX_Items_FolderId" ON "Items" ("FolderId");

CREATE INDEX "IX_Items_LogoId" ON "Items" ("LogoId");

CREATE INDEX "IX_ItemTags_ItemId" ON "ItemTags" ("ItemId");

CREATE UNIQUE INDEX "IX_ItemTags_ItemId_TagId" ON "ItemTags" ("ItemId", "TagId");

CREATE INDEX "IX_ItemTags_TagId" ON "ItemTags" ("TagId");

CREATE UNIQUE INDEX "IX_Logos_Source" ON "Logos" ("Source");

CREATE INDEX "IX_Tags_Name" ON "Tags" ("Name");


                INSERT INTO Items (Id, Name, ItemType, LogoId, FolderId, CreatedAt, UpdatedAt, IsDeleted)
                SELECT
                  c.Id,
                  s.Name AS Name,
                  CASE
                    WHEN a.Id IS NOT NULL AND (
                      (a.FirstName IS NOT NULL AND a.FirstName != '') OR
                      (a.LastName IS NOT NULL AND a.LastName != '') OR
                      (a.Gender IS NOT NULL AND a.Gender != '') OR
                      (a.BirthDate IS NOT NULL AND a.BirthDate != '' AND a.BirthDate NOT LIKE '0001-%')
                    ) THEN 'Alias'
                    ELSE 'Login'
                  END AS ItemType,
                  NULL AS LogoId,
                  NULL AS FolderId,
                  c.CreatedAt,
                  c.UpdatedAt,
                  c.IsDeleted
                FROM Credentials c
                LEFT JOIN Services s ON s.Id = c.ServiceId
                LEFT JOIN Aliases a ON a.Id = c.AliasId;
            


                INSERT INTO Logos (Id, Source, FileData, MimeType, FetchedAt, CreatedAt, UpdatedAt, IsDeleted)
                SELECT
                  UPPER(SUBSTR(hex(randomblob(4)), 1, 8) || '-' ||
                        SUBSTR(hex(randomblob(2)), 1, 4) || '-' ||
                        SUBSTR(hex(randomblob(2)), 1, 4) || '-' ||
                        SUBSTR(hex(randomblob(2)), 1, 4) || '-' ||
                        SUBSTR(hex(randomblob(6)), 1, 12)) AS Id,
                  -- Extract and normalize hostname: remove protocol, path, lowercase, and www. prefix
                  REPLACE(
                    LOWER(
                      SUBSTR(
                        CASE
                          WHEN s.Url LIKE 'https://%' THEN SUBSTR(s.Url, 9)
                          WHEN s.Url LIKE 'http://%' THEN SUBSTR(s.Url, 8)
                          ELSE s.Url
                        END,
                        1,
                        CASE
                          WHEN INSTR(
                            CASE
                              WHEN s.Url LIKE 'https://%' THEN SUBSTR(s.Url, 9)
                              WHEN s.Url LIKE 'http://%' THEN SUBSTR(s.Url, 8)
                              ELSE s.Url
                            END, '/') > 0
                          THEN INSTR(
                            CASE
                              WHEN s.Url LIKE 'https://%' THEN SUBSTR(s.Url, 9)
                              WHEN s.Url LIKE 'http://%' THEN SUBSTR(s.Url, 8)
                              ELSE s.Url
                            END, '/') - 1
                          ELSE LENGTH(
                            CASE
                              WHEN s.Url LIKE 'https://%' THEN SUBSTR(s.Url, 9)
                              WHEN s.Url LIKE 'http://%' THEN SUBSTR(s.Url, 8)
                              ELSE s.Url
                            END)
                        END
                      )
                    ),
                    'www.', ''
                  ) AS Source,
                  s.Logo AS FileData,
                  'image/png' AS MimeType,
                  NULL AS FetchedAt,
                  MIN(s.CreatedAt) AS CreatedAt,
                  MAX(s.UpdatedAt) AS UpdatedAt,
                  0 AS IsDeleted
                FROM Services s
                WHERE s.Logo IS NOT NULL AND s.Url IS NOT NULL AND s.Url != ''
                GROUP BY REPLACE(
                    LOWER(
                      SUBSTR(
                        CASE
                          WHEN s.Url LIKE 'https://%' THEN SUBSTR(s.Url, 9)
                          WHEN s.Url LIKE 'http://%' THEN SUBSTR(s.Url, 8)
                          ELSE s.Url
                        END,
                        1,
                        CASE
                          WHEN INSTR(
                            CASE
                              WHEN s.Url LIKE 'https://%' THEN SUBSTR(s.Url, 9)
                              WHEN s.Url LIKE 'http://%' THEN SUBSTR(s.Url, 8)
                              ELSE s.Url
                            END, '/') > 0
                          THEN INSTR(
                            CASE
                              WHEN s.Url LIKE 'https://%' THEN SUBSTR(s.Url, 9)
                              WHEN s.Url LIKE 'http://%' THEN SUBSTR(s.Url, 8)
                              ELSE s.Url
                            END, '/') - 1
                          ELSE LENGTH(
                            CASE
                              WHEN s.Url LIKE 'https://%' THEN SUBSTR(s.Url, 9)
                              WHEN s.Url LIKE 'http://%' THEN SUBSTR(s.Url, 8)
                              ELSE s.Url
                            END)
                        END
                      )
                    ),
                    'www.', ''
                  );
            


                UPDATE Items
                SET LogoId = (
                  SELECT l.Id FROM Logos l
                  INNER JOIN Services s ON REPLACE(
                    LOWER(
                      SUBSTR(
                        CASE
                          WHEN s.Url LIKE 'https://%' THEN SUBSTR(s.Url, 9)
                          WHEN s.Url LIKE 'http://%' THEN SUBSTR(s.Url, 8)
                          ELSE s.Url
                        END,
                        1,
                        CASE
                          WHEN INSTR(
                            CASE
                              WHEN s.Url LIKE 'https://%' THEN SUBSTR(s.Url, 9)
                              WHEN s.Url LIKE 'http://%' THEN SUBSTR(s.Url, 8)
                              ELSE s.Url
                            END, '/') > 0
                          THEN INSTR(
                            CASE
                              WHEN s.Url LIKE 'https://%' THEN SUBSTR(s.Url, 9)
                              WHEN s.Url LIKE 'http://%' THEN SUBSTR(s.Url, 8)
                              ELSE s.Url
                            END, '/') - 1
                          ELSE LENGTH(
                            CASE
                              WHEN s.Url LIKE 'https://%' THEN SUBSTR(s.Url, 9)
                              WHEN s.Url LIKE 'http://%' THEN SUBSTR(s.Url, 8)
                              ELSE s.Url
                            END)
                        END
                      )
                    ),
                    'www.', ''
                  ) = l.Source
                  INNER JOIN Credentials c ON c.ServiceId = s.Id
                  WHERE c.Id = Items.Id
                  LIMIT 1
                )
                WHERE EXISTS (
                  SELECT 1 FROM Credentials c
                  INNER JOIN Services s ON s.Id = c.ServiceId
                  WHERE c.Id = Items.Id AND s.Logo IS NOT NULL
                );
            


                INSERT INTO FieldValues (Id, ItemId, FieldDefinitionId, FieldKey, Value, Weight, CreatedAt, UpdatedAt, IsDeleted)
                SELECT
                  UPPER(SUBSTR(hex(randomblob(4)), 1, 8) || '-' ||
                        SUBSTR(hex(randomblob(2)), 1, 4) || '-' ||
                        SUBSTR(hex(randomblob(2)), 1, 4) || '-' ||
                        SUBSTR(hex(randomblob(2)), 1, 4) || '-' ||
                        SUBSTR(hex(randomblob(6)), 1, 12)) AS Id,
                  c.Id AS ItemId,
                  NULL AS FieldDefinitionId,
                  'login.url' AS FieldKey,
                  s.Url AS Value,
                  0 AS Weight,
                  s.UpdatedAt AS CreatedAt,
                  s.UpdatedAt AS UpdatedAt,
                  0 AS IsDeleted
                FROM Credentials c
                INNER JOIN Services s ON s.Id = c.ServiceId
                WHERE s.Url IS NOT NULL AND s.Url != '';
            


                INSERT INTO FieldValues (Id, ItemId, FieldDefinitionId, FieldKey, Value, Weight, CreatedAt, UpdatedAt, IsDeleted)
                SELECT
                  UPPER(SUBSTR(hex(randomblob(4)), 1, 8) || '-' ||
                        SUBSTR(hex(randomblob(2)), 1, 4) || '-' ||
                        SUBSTR(hex(randomblob(2)), 1, 4) || '-' ||
                        SUBSTR(hex(randomblob(2)), 1, 4) || '-' ||
                        SUBSTR(hex(randomblob(6)), 1, 12)) AS Id,
                  c.Id AS ItemId,
                  NULL AS FieldDefinitionId,
                  'login.username' AS FieldKey,
                  c.Username AS Value,
                  0 AS Weight,
                  c.UpdatedAt AS CreatedAt,
                  c.UpdatedAt AS UpdatedAt,
                  0 AS IsDeleted
                FROM Credentials c
                WHERE c.Username IS NOT NULL AND c.Username != '';
            


                INSERT INTO FieldValues (Id, ItemId, FieldDefinitionId, FieldKey, Value, Weight, CreatedAt, UpdatedAt, IsDeleted)
                SELECT
                  UPPER(SUBSTR(hex(randomblob(4)), 1, 8) || '-' ||
                        SUBSTR(hex(randomblob(2)), 1, 4) || '-' ||
                        SUBSTR(hex(randomblob(2)), 1, 4) || '-' ||
                        SUBSTR(hex(randomblob(2)), 1, 4) || '-' ||
                        SUBSTR(hex(randomblob(6)), 1, 12)) AS Id,
                  c.Id AS ItemId,
                  NULL AS FieldDefinitionId,
                  'login.notes' AS FieldKey,
                  c.Notes AS Value,
                  0 AS Weight,
                  c.UpdatedAt AS CreatedAt,
                  c.UpdatedAt AS UpdatedAt,
                  0 AS IsDeleted
                FROM Credentials c
                WHERE c.Notes IS NOT NULL AND c.Notes != '';
            


                INSERT INTO FieldValues (Id, ItemId, FieldDefinitionId, FieldKey, Value, Weight, CreatedAt, UpdatedAt, IsDeleted)
                SELECT
                  UPPER(SUBSTR(hex(randomblob(4)), 1, 8) || '-' ||
                        SUBSTR(hex(randomblob(2)), 1, 4) || '-' ||
                        SUBSTR(hex(randomblob(2)), 1, 4) || '-' ||
                        SUBSTR(hex(randomblob(2)), 1, 4) || '-' ||
                        SUBSTR(hex(randomblob(6)), 1, 12)) AS Id,
                  p.CredentialId AS ItemId,
                  NULL AS FieldDefinitionId,
                  'login.password' AS FieldKey,
                  p.Value AS Value,
                  0 AS Weight,
                  p.UpdatedAt AS CreatedAt,
                  p.UpdatedAt AS UpdatedAt,
                  0 AS IsDeleted
                FROM Passwords p
                INNER JOIN (
                  SELECT CredentialId, MAX(UpdatedAt) AS MaxUpdated, MAX(Id) AS MaxId
                  FROM Passwords
                  WHERE IsDeleted = 0
                  GROUP BY CredentialId
                ) pm ON p.CredentialId = pm.CredentialId AND p.UpdatedAt = pm.MaxUpdated AND p.Id = pm.MaxId
                WHERE p.IsDeleted = 0;
            


                INSERT INTO FieldValues (Id, ItemId, FieldDefinitionId, FieldKey, Value, Weight, CreatedAt, UpdatedAt, IsDeleted)
                SELECT
                  UPPER(SUBSTR(hex(randomblob(4)), 1, 8) || '-' ||
                        SUBSTR(hex(randomblob(2)), 1, 4) || '-' ||
                        SUBSTR(hex(randomblob(2)), 1, 4) || '-' ||
                        SUBSTR(hex(randomblob(2)), 1, 4) || '-' ||
                        SUBSTR(hex(randomblob(6)), 1, 12)) AS Id,
                  c.Id AS ItemId,
                  NULL AS FieldDefinitionId,
                  'login.email' AS FieldKey,
                  a.Email AS Value,
                  0 AS Weight,
                  a.UpdatedAt AS CreatedAt,
                  a.UpdatedAt AS UpdatedAt,
                  0 AS IsDeleted
                FROM Credentials c
                INNER JOIN Aliases a ON a.Id = c.AliasId
                WHERE a.Email IS NOT NULL AND a.Email != '';
            


                INSERT INTO FieldValues (Id, ItemId, FieldDefinitionId, FieldKey, Value, Weight, CreatedAt, UpdatedAt, IsDeleted)
                SELECT
                  UPPER(SUBSTR(hex(randomblob(4)), 1, 8) || '-' ||
                        SUBSTR(hex(randomblob(2)), 1, 4) || '-' ||
                        SUBSTR(hex(randomblob(2)), 1, 4) || '-' ||
                        SUBSTR(hex(randomblob(2)), 1, 4) || '-' ||
                        SUBSTR(hex(randomblob(6)), 1, 12)) AS Id,
                  c.Id AS ItemId,
                  NULL AS FieldDefinitionId,
                  'alias.first_name' AS FieldKey,
                  a.FirstName AS Value,
                  0 AS Weight,
                  a.UpdatedAt AS CreatedAt,
                  a.UpdatedAt AS UpdatedAt,
                  0 AS IsDeleted
                FROM Credentials c
                INNER JOIN Aliases a ON a.Id = c.AliasId
                WHERE a.FirstName IS NOT NULL AND a.FirstName != '';
            


                INSERT INTO FieldValues (Id, ItemId, FieldDefinitionId, FieldKey, Value, Weight, CreatedAt, UpdatedAt, IsDeleted)
                SELECT
                  UPPER(SUBSTR(hex(randomblob(4)), 1, 8) || '-' ||
                        SUBSTR(hex(randomblob(2)), 1, 4) || '-' ||
                        SUBSTR(hex(randomblob(2)), 1, 4) || '-' ||
                        SUBSTR(hex(randomblob(2)), 1, 4) || '-' ||
                        SUBSTR(hex(randomblob(6)), 1, 12)) AS Id,
                  c.Id AS ItemId,
                  NULL AS FieldDefinitionId,
                  'alias.last_name' AS FieldKey,
                  a.LastName AS Value,
                  0 AS Weight,
                  a.UpdatedAt AS CreatedAt,
                  a.UpdatedAt AS UpdatedAt,
                  0 AS IsDeleted
                FROM Credentials c
                INNER JOIN Aliases a ON a.Id = c.AliasId
                WHERE a.LastName IS NOT NULL AND a.LastName != '';
            


                INSERT INTO FieldValues (Id, ItemId, FieldDefinitionId, FieldKey, Value, Weight, CreatedAt, UpdatedAt, IsDeleted)
                SELECT
                  UPPER(SUBSTR(hex(randomblob(4)), 1, 8) || '-' ||
                        SUBSTR(hex(randomblob(2)), 1, 4) || '-' ||
                        SUBSTR(hex(randomblob(2)), 1, 4) || '-' ||
                        SUBSTR(hex(randomblob(2)), 1, 4) || '-' ||
                        SUBSTR(hex(randomblob(6)), 1, 12)) AS Id,
                  c.Id AS ItemId,
                  NULL AS FieldDefinitionId,
                  'alias.gender' AS FieldKey,
                  a.Gender AS Value,
                  0 AS Weight,
                  a.UpdatedAt AS CreatedAt,
                  a.UpdatedAt AS UpdatedAt,
                  0 AS IsDeleted
                FROM Credentials c
                INNER JOIN Aliases a ON a.Id = c.AliasId
                WHERE a.Gender IS NOT NULL AND a.Gender != '';
            


                INSERT INTO FieldValues (Id, ItemId, FieldDefinitionId, FieldKey, Value, Weight, CreatedAt, UpdatedAt, IsDeleted)
                SELECT
                  UPPER(SUBSTR(hex(randomblob(4)), 1, 8) || '-' ||
                        SUBSTR(hex(randomblob(2)), 1, 4) || '-' ||
                        SUBSTR(hex(randomblob(2)), 1, 4) || '-' ||
                        SUBSTR(hex(randomblob(2)), 1, 4) || '-' ||
                        SUBSTR(hex(randomblob(6)), 1, 12)) AS Id,
                  c.Id AS ItemId,
                  NULL AS FieldDefinitionId,
                  'alias.birthdate' AS FieldKey,
                  SUBSTR(a.BirthDate, 1, 10) AS Value,
                  0 AS Weight,
                  a.UpdatedAt AS CreatedAt,
                  a.UpdatedAt AS UpdatedAt,
                  0 AS IsDeleted
                FROM Credentials c
                INNER JOIN Aliases a ON a.Id = c.AliasId
                WHERE a.BirthDate IS NOT NULL AND a.BirthDate != '' AND a.BirthDate NOT LIKE '0001-%';
            

DROP TABLE "Passwords";

DROP TABLE "Credentials";

DROP TABLE "Aliases";

DROP TABLE "Services";

CREATE TABLE "ef_temp_Attachments" (
    "Id" TEXT NOT NULL CONSTRAINT "PK_Attachments" PRIMARY KEY,
    "Blob" BLOB NOT NULL,
    "CreatedAt" TEXT NOT NULL,
    "Filename" TEXT NOT NULL,
    "IsDeleted" INTEGER NOT NULL,
    "ItemId" TEXT NOT NULL,
    "UpdatedAt" TEXT NOT NULL,
    CONSTRAINT "FK_Attachments_Items_ItemId" FOREIGN KEY ("ItemId") REFERENCES "Items" ("Id") ON DELETE CASCADE
);

INSERT INTO "ef_temp_Attachments" ("Id", "Blob", "CreatedAt", "Filename", "IsDeleted", "ItemId", "UpdatedAt")
SELECT "Id", "Blob", "CreatedAt", "Filename", "IsDeleted", "ItemId", "UpdatedAt"
FROM "Attachments";

CREATE TABLE "ef_temp_Passkeys" (
    "Id" TEXT NOT NULL CONSTRAINT "PK_Passkeys" PRIMARY KEY,
    "AdditionalData" BLOB NULL,
    "CreatedAt" TEXT NOT NULL,
    "DisplayName" TEXT NOT NULL,
    "IsDeleted" INTEGER NOT NULL,
    "ItemId" TEXT NOT NULL,
    "PrfKey" BLOB NULL,
    "PrivateKey" TEXT NOT NULL,
    "PublicKey" TEXT NOT NULL,
    "RpId" TEXT COLLATE NOCASE NOT NULL,
    "UpdatedAt" TEXT NOT NULL,
    "UserHandle" BLOB NOT NULL,
    CONSTRAINT "FK_Passkeys_Items_ItemId" FOREIGN KEY ("ItemId") REFERENCES "Items" ("Id") ON DELETE CASCADE
);

INSERT INTO "ef_temp_Passkeys" ("Id", "AdditionalData", "CreatedAt", "DisplayName", "IsDeleted", "ItemId", "PrfKey", "PrivateKey", "PublicKey", "RpId", "UpdatedAt", "UserHandle")
SELECT "Id", "AdditionalData", "CreatedAt", "DisplayName", "IsDeleted", "ItemId", "PrfKey", "PrivateKey", "PublicKey", "RpId", "UpdatedAt", "UserHandle"
FROM "Passkeys";

CREATE TABLE "ef_temp_TotpCodes" (
    "Id" TEXT NOT NULL CONSTRAINT "PK_TotpCodes" PRIMARY KEY,
    "CreatedAt" TEXT NOT NULL,
    "IsDeleted" INTEGER NOT NULL,
    "ItemId" TEXT NOT NULL,
    "Name" TEXT NOT NULL,
    "SecretKey" TEXT NOT NULL,
    "UpdatedAt" TEXT NOT NULL,
    CONSTRAINT "FK_TotpCodes_Items_ItemId" FOREIGN KEY ("ItemId") REFERENCES "Items" ("Id") ON DELETE CASCADE
);

INSERT INTO "ef_temp_TotpCodes" ("Id", "CreatedAt", "IsDeleted", "ItemId", "Name", "SecretKey", "UpdatedAt")
SELECT "Id", "CreatedAt", "IsDeleted", "ItemId", "Name", "SecretKey", "UpdatedAt"
FROM "TotpCodes";

COMMIT;

PRAGMA foreign_keys = 0;

BEGIN TRANSACTION;
DROP TABLE "Attachments";

ALTER TABLE "ef_temp_Attachments" RENAME TO "Attachments";

DROP TABLE "Passkeys";

ALTER TABLE "ef_temp_Passkeys" RENAME TO "Passkeys";

DROP TABLE "TotpCodes";

ALTER TABLE "ef_temp_TotpCodes" RENAME TO "TotpCodes";

COMMIT;

PRAGMA foreign_keys = 1;

BEGIN TRANSACTION;
CREATE INDEX "IX_Attachments_ItemId" ON "Attachments" ("ItemId");

CREATE INDEX "IX_Passkeys_ItemId" ON "Passkeys" ("ItemId");

CREATE INDEX "IX_Passkeys_RpId" ON "Passkeys" ("RpId");

CREATE INDEX "IX_TotpCodes_ItemId" ON "TotpCodes" ("ItemId");

COMMIT;

INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
VALUES ('20251213111207_1.7.0-FieldBasedDataModelUpdate', '9.0.4');

