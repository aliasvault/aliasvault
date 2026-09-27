# Shared image assets

Source images for the apps. `sync.sh` copies each file to the destinations listed in `targets.txt`; the copies stay in the app folders so each app builds on its own. This ensures that all apps share the same base brand assets, and any future changes can be easily synced to all apps.

Edit a file here (and add a `<source> <destination>` line to `targets.txt` when you add one), then run the script from this folder:

```bash
./sync.sh           # copy sources to their destinations
./sync.sh --check   # fail if a copy is missing, stale, or unmanaged
./sync.sh --list    # print each source and where it is copied
```
