#! /bin/bash
source /etc/profile.d/bsenv.sh
export GRADLE_USER_HOME=$home_vagrant/.gradle

# Set up environment for fdroid (no sudo needed, we're already vagrant user)
export PATH=$fdroidserver:$PATH
export PYTHONPATH=$fdroidserver:$fdroidserver/examples
export PYTHONUNBUFFERED=true
export HOME=$home_vagrant

# Clone dirs
git clone https://gitlab.com/fdroid/fdroidserver.git --depth 1 /home/vagrant/fdroidserver
git clone https://gitlab.com/fdroid/fdroiddata.git --depth 1 /home/vagrant/build

# Overwrite metatdata for on-demand main branch build
cp -R net.aliasvault.app.yml /home/vagrant/build/metadata/net.aliasvault.app.yml

# go to build
cd /home/vagrant/build

# Fetch dependent libraries (if any)
fdroid fetchsrclibs net.aliasvault.app --verbose
# Format build receipe
fdroid rewritemeta net.aliasvault.app
# Lint app
fdroid lint --verbose net.aliasvault.app
# Build app and scan for any binary files that are prohibited
fdroid build --verbose --test --latest --scan-binary --on-server --no-tarball net.aliasvault.app
# Copy any outputs to the bind mount folder
rsync -avh /home/vagrant/build/build/net.aliasvault.app/apps/mobile-app/android/app/build/outputs/ /outputs/
