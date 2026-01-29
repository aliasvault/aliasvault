---
layout: default
title: Upgrade the AliasServerDb EF model
parent: Development
grand_parent: Miscellaneous
nav_order: 6
---

# Upgrade the AliasServerDb EF model

## Create new migration
The below command allows you to create a new EF migration based on the existing database structure as defined in the EF mode classes.

```bash
cd apps/server/Databases/AliasServerDb
dotnet ef migrations add NewMigrationDescription
```

When (re)starting the API, any new migrations are automatically applied to the database.

## Remove migration
In order to remove one or more added migrations, run the following command:

```bash
dotnet ef migrations remove
```

> Note: if you get an error stating the migration has already been applied, first rollback the database following the instructions below.

# Rollback AliasServerDb database to previous migration

To rollback the database and undo one or more applied migrations, run the command below and replace the `ChangeDeviceIdentifierToTextfield` with the name of the target migration to revert back to.

So e.g. if target migration is called: `20250922173722_ChangeDeviceIdentifierToTextField.cs` then run this command:

```bash
cd apps/server/Databases/AliasServerDb
dotnet ef database update ChangeDeviceIdentifierToTextField
```
