# AliasVault documentation

The documentation site for AliasVault ([docs.aliasvault.com](https://docs.aliasvault.com)),
built with [Docusaurus](https://docusaurus.io/).

## Run locally (development)

Hot-reloading dev server:

```bash
npm ci        # first time, or when dependencies change
npm start     # serves at http://localhost:5190
```

## Run locally with Docker

Serves the production build through nginx, exactly as it runs in production.
The site must be built first, then Docker just serves the static output:

```bash
npm ci && npm run build      # produces ./build
docker compose up -d --build # serves at http://localhost:5191
docker compose down          # stop
```

## Deployment

Deployment is automated — see [`.github/workflows/deploy-docs.yml`](../.github/workflows/deploy-docs.yml).
It builds the static site in CI and ships it to the docs server:

- **Automatically** on every published GitHub release.
- **Manually** via the Actions tab → *Deploy docs* → *Run workflow*, where you
  can choose the branch or tag to deploy from.

Server-side setup is documented internally.
