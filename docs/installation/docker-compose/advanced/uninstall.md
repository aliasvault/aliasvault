---
layout: default
title: Uninstall
parent: Advanced
grand_parent: Docker Compose
nav_order: 4
---

# Uninstall

To uninstall AliasVault, run the following command. This will stop and remove the AliasVault containers and remove the Docker images.

{: .note }
This will not delete any data stored in the database. If you wish to delete all data, you should manually delete the `database` directory and the other directories created by AliasVault.

### Steps
1. Run docker compose down and remove any local Docker images related to AliasVault.
```bash
$ docker compose down --rmi all
```
