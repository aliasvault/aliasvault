FROM registry.gitlab.com/fdroid/fdroidserver:buildserver

# Switch to root to install packages
USER root

# Install required tools
RUN apt-get update && apt-get install -y \
    wget \
    unzip \
    openjdk-17-jdk-headless \
    && rm -rf /var/lib/apt/lists/*

# Pin JDK 17 so Gradle's toolchain detector always finds it
ENV JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
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
