---
sidebar_position: 4
sidebar_label: "Uninstall"
---
# Uninstall

To uninstall AliasVault, run the install script with the `uninstall` option. This will stop and remove the AliasVault containers and remove any local AliasVault Docker images.

:::note
This will not delete any data stored in the database. If you wish to delete all data, you should manually delete the `database` directory and the other directories created by AliasVault.
:::

### Steps
1. Run the install script with the `uninstall` option
```bash
$ ./install.sh uninstall
```
