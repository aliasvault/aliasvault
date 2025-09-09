---
layout: default
title: Stop/start
parent: Advanced
grand_parent: Docker Compose
nav_order: 2
---

# Stopping and starting AliasVault
You can stop and start AliasVault via the default docker compose commands. Run these commands from the directory where your AliasVault `docker-compose.yml` is located.

## Stop
To stop AliasVault:
```bash
$ docker compose down
```

## Start
To start AliasVault:

```bash
$ docker compose up -d
```

## Restart
To restart AliasVault (note: when making changes to the `docker-compose.yml`, you'll need to manually stop and start to make the new changes be applied)

```bash
$ docker compose restart
```
