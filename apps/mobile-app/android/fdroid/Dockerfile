FROM registry.gitlab.com/fdroid/fdroidserver:buildserver

# Switch to root to install packages
USER root

# Install required tools
RUN apt-get update && apt-get install -y \
    wget \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# Install Temurin JDK 17
RUN mkdir -p /opt/jdk-17 && \
    wget -q https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.13%2B11/OpenJDK17U-jdk_x64_linux_hotspot_17.0.13_11.tar.gz -O /tmp/jdk17.tar.gz && \
    tar -xzf /tmp/jdk17.tar.gz -C /opt/jdk-17 --strip-components=1 && \
    rm /tmp/jdk17.tar.gz

ENV JAVA_HOME=/opt/jdk-17
ENV PATH=$JAVA_HOME/bin:$PATH

# Set Android SDK environment variables
ENV ANDROID_SDK_ROOT=/opt/android-sdk
ENV ANDROID_HOME=/opt/android-sdk
ENV PATH=$PATH:$ANDROID_SDK_ROOT/cmdline-tools/latest/bin:$ANDROID_SDK_ROOT/platform-tools

# Create Android SDK directory
RUN mkdir -p $ANDROID_SDK_ROOT

# Download and install Android command line tools
RUN wget -q https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip -O /tmp/cmdline-tools.zip && \
    unzip -q /tmp/cmdline-tools.zip -d /tmp/cmdline-tools && \
    mkdir -p $ANDROID_SDK_ROOT/cmdline-tools/latest && \
    mv /tmp/cmdline-tools/cmdline-tools/* $ANDROID_SDK_ROOT/cmdline-tools/latest/ && \
    rm -rf /tmp/cmdline-tools.zip /tmp/cmdline-tools

# Accept Android SDK licenses
RUN yes | $ANDROID_SDK_ROOT/cmdline-tools/latest/bin/sdkmanager --licenses || true

# Install required Android SDK components
# These versions should match what your app needs
RUN $ANDROID_SDK_ROOT/cmdline-tools/latest/bin/sdkmanager \
    "platform-tools" \
    "platforms;android-34" \
    "platforms;android-33" \
    "platforms;android-30" \
    "build-tools;34.0.0" \
    "build-tools;33.0.0" \
    "ndk;28.0.12433566" \
    "cmake;3.22.1"

# Set proper permissions
RUN chown -R vagrant:vagrant $ANDROID_SDK_ROOT
