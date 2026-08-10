# SQL Generation Scripts

This directory contains scripts to generate SQL files from Entity Framework Core migrations and convert them to TypeScript constants which are used by the `./core/vault` TypeScript library.

This library is consumed by the web app, browser extensions and mobile apps for vault creation and upgrades.

Refer to the docs `upgrade-ef-client-model.md` for how this scripts are used.

## The migration chain is frozen at vault version 2.0.0

After vault version 2.0.0, the SQLite schema is always recreated directly from the full schema script, so incremental client migrations are no longer used. Numbered `NNN_*.sql` files are legacy and can be removed once all users are on version 2.0.0 or higher.

## Rules for migrations after 2.0.0

Post-2.0.0, EF migrations are only used to generate the up-to-date full schema. Data-changing SQL is not required as the newest DB schema is used before materialization.
