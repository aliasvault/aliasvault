#!/bin/bash

# Extract the screenshots from the xcresult bundle downloaded from GitHub Actions
# This can be used for debugging purposes.
# Requires: brew install chargepoint/xcparse/xcparse
unzip ~/Downloads/ios-ui-test-results.zip -d ~/Downloads/ios-ui-test-results
xcparse screenshots ~/Downloads/ios-ui-test-results ~/Downloads/ios-ui-screenshots