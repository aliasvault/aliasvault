
# F-Droid local test builds
This folder contains Docker container scripts for testing F-Droid builds locally.
When you run the local setup, it automatically pulls the latest `main` branch from aliasvault/aliasvault and builds the app. This process verifies that all app sources are fully FOSS (Free and Open Source Software).

## Run local F-Droid build against latest main branch

1. Build and run the F-Droid docker container
```bash
./run.sh
```

2. Inside the Docker container, run this:
```bash
./build.sh
```

The build process can take a while, upwards of 30min. Final output should look like this:
```bash
 Task :app:packageRelease
> Task :app:createReleaseApkListingFileRedirect
> Task :app:lintVitalAnalyzeRelease
> Task :app:lintVitalReportRelease
> Task :app:lintVitalRelease
> Task :app:assembleRelease

[Incubating] Problems report is available at: file:///build/build/net.aliasvault.app/apps/mobile-app/android/build/reports/problems/problems-report.html

Deprecated Gradle features were used in this build, making it incompatible with Gradle 9.0.

You can use '--warning-mode all' to show the individual deprecation warnings and determine if they come from your own scripts or plugins.

For more on this, please refer to https://docs.gradle.org/8.13/userguide/command_line_interface.html#sec:command_line_warnings in the Gradle documentation.

BUILD SUCCESSFUL in 30m 25s
1564 actionable tasks: 1563 executed, 1 up-to-date
2025-11-03 16:40:56,157 INFO: Successfully built version 0.99.0-test1 of net.aliasvault.app from 97d8d4d15df88cd759b62489368e857291a27078
```

This is the important part to know whether the build was succesful:
> BUILD SUCCESSFUL in 30m 25s

Other warnings can be ignored as they are most likely about versions not matching, but that is to be expected as we have hardcoded the version to 0.1.0 while the actual version extracted from the Android build.gradle file will be different.

## Run F-Droid build against specific commit
If you wish to test F-Droid which a specific commit, edit the `net.aliasvault.app.yml` file and change the `commit` line here:

```yaml
  - versionName: 0.1.0
    versionCode: 1
    commit: main
```

to include a specific commit:
```yaml
  - versionName: 0.1.0
    versionCode: 1
    commit: 4010631d7380fc4ca5538a43afd21527287fd913
```

Then run the above build again, which will now checkout this specific commit and try to build it.