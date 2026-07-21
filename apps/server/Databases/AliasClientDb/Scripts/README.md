# SQL Generation Scripts

This directory contains scripts to generate SQL files from Entity Framework Core migrations and convert them to TypeScript constants which are used by the `./core/vault` TypeScript library.

This library is consumed by the web app, browser extensions and mobile apps for vault creation and upgrades.

Refer to the docs `upgrade-ef-client-model.md` for how this scripts are used.

## The migration chain is frozen at vault version 2.0.0

Since the manifest-v1 storage model (vault version 2.0.0, revision 13) every vault pull re-materializes the local SQLite from the full schema (`000_FullSchema.sql` / `COMPLETE_SCHEMA_SQL`), so individual client migrations are no longer added after 2.0.0.

The individual migrations can be fully removed once all active users have migrated to 2.0.0+, as that version is compatible with the manifest-v1 structure.
