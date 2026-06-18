---
sidebar_position: 1
sidebar_label: "Development setup"
---
# Development setup

How to run AliasVault from source.

:::note Windows users
Note for Windows users: the AliasVault development tooling is built around Linux and bash scripts (e.g. `./scripts/dev.sh`), so some commands may need to be altered for it to work on Windows. We also advise using **WSL** (Windows Subsystem for Linux).
:::

## Prerequisites

- **.NET 10 SDK**: https://dotnet.microsoft.com/download/dotnet/10.0
- **Docker Desktop**
- **`dotnet-ef`** tools, if you'll touch the database: `dotnet tool install --global dotnet-ef`
- **Rust** The AliasVault apps depend on the Rust core, which needs to be compiled locally. Install [rustup](https://rustup.rs), then `rustup target add wasm32-unknown-unknown` and `cargo install wasm-pack`. Build the core with `./core/rust/build.sh --browser`.

## Running the apps

`./scripts/dev.sh` is the single entry point for local development. It starts the
dev database and runs each app from source on a consistent, preconfigured set of
ports (so the apps always find each other). Each invocation starts one app, so use
a terminal per app (or the VS Code tasks, which fan out one call per app):

```bash
./scripts/dev.sh db-start   # start the dev database first (db-stop to stop it)
./scripts/dev.sh api        # the API
./scripts/dev.sh client     # the Blazor client (writes its dev appsettings for you)
./scripts/dev.sh admin      # the admin web app
./scripts/dev.sh            # no argument → interactive menu
./scripts/dev.sh ports      # print the resolved port map (defaults: API 5100, db 5109)
```

You can also run an individual project from your IDE; `./scripts/dev.sh ports`
shows which ports it expects.

### Tailwind CSS

The Admin and Client projects compile their CSS with Tailwind:

```bash
cd apps/server/AliasVault.Admin  && npm run build:admin-css
cd apps/server/AliasVault.Client && npm run build:client-css
```

### Dev client settings

`./scripts/dev.sh client` generates `wwwroot/appsettings.Development.json` with the
correct `ApiUrl` for your ports automatically. Only create it manually if you run
the client some other way:

```json
{
    "ApiUrl": "http://localhost:5100",
    "PrivateEmailDomains": ["example.tld"],
    "SupportEmail": "support@example.tld",
    "UseDebugEncryptionKey": "true",
    "CryptographyOverrideType": "Argon2Id",
    "CryptographyOverrideSettings": "{\"DegreeOfParallelism\":1,\"MemorySize\":1024,\"Iterations\":1}"
}
```

### E2E tests (Playwright)

```bash
dotnet tool install --global Microsoft.Playwright.CLI
pwsh apps/server/Tests/AliasVault.E2ETests/bin/Debug/net10.0/playwright.ps1 install
```

## Troubleshooting

- **Database**: check it's up with `docker ps | grep postgres-dev`, view logs with
  `docker logs aliasvault-dev-postgres-dev-1`, or restart with
  `./scripts/dev.sh db-stop && ./scripts/dev.sh db-start`.
- **Port conflicts**: run `./scripts/dev.sh ports` to see what's in use. If a port is
  taken, bump `AV_INSTANCE` in `dev.env` to shift the whole block.
- **WSL (Windows)**: if Postgres hits permission errors on first start, fix the data
  dir with `sudo chown -R 999:999 ./database/postgres && sudo chmod -R 700 ./database/postgres`.
  Reset WSL itself with `wsl --update` / `wsl --shutdown`.
