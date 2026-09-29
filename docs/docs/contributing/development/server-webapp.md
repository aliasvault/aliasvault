---
sidebar_position: 2
sidebar_label: "Server & web app"
---
# Server & web app

The AliasVault server (the API, the Admin app and the background services) is built with [.NET 10](https://dotnet.microsoft.com/); the Admin app uses [Blazor Server](https://learn.microsoft.com/aspnet/core/blazor/). The web app in `apps/web` is a React app (Vite, TypeScript, Tailwind CSS) that runs on the shared client core in `core/client` and the Rust core compiled to WebAssembly.

You can open the .NET solution in [Visual Studio 2026+](https://visualstudio.microsoft.com/), [Visual Studio Code](https://code.visualstudio.com/) or [JetBrains Rider](https://www.jetbrains.com/rider/) and work on it like any other .NET project. The web app is a regular npm project.

## Running it locally

The recommended way to run the server apps from source is via `./scripts/dev.sh`, which starts each app on a consistent set of ports. See the [Development setup](development-setup.md#running-the-apps) guide for the full workflow:

```bash
./scripts/dev.sh db-start   # start the dev database
./scripts/dev.sh api        # the API
./scripts/dev.sh web        # the web app
./scripts/dev.sh admin      # the Admin app
```

You can also run or debug any of these projects directly from your IDE; run `./scripts/dev.sh ports` to see which ports each one expects.

The web app needs the Rust core built for the browser once (`cd apps/web && npm run build:rust`) before `npm install`.
