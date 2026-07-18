---
sidebar_position: 3
sidebar_label: "Self-Signed SSL Setup"
---
# Self-Signed SSL Certificate Setup for iOS

By default, the AliasVault iOS app only supports connecting to servers with a valid SSL certificate from a trusted external authority. If you want to use your own self-signed certificate, you must manually install and trust the certificate on your iOS device by following these steps.

## Server Setup

### Standard Installation
Configure your hostname and restart AliasVault:
```bash
./install.sh configure-hostname
./install.sh restart
```

### All-in-One Docker
Update your `docker-compose.yml`:
```yaml
environment:
  HOSTNAME: "192.168.3.2"  # Your server IP/hostname
```
Then restart: `docker compose down && docker compose up -d`

## Step 1: Get the Certificate

### Option A: From Browser
1. Open Chrome on your computer, go to your AliasVault instance (e.g., `https://192.168.3.2`)
2. Click the padlock icon → inspect certificate
3. Export the certificate and send it to your device (e.g. via email)

### Option B: From Server
Copy from your AliasVault installation directory:
```bash
cp [aliasvault-install-dir]/certificates/ssl/cert.pem ~/aliasvault.crt
```

## Step 2: Install Certificate Profile

1. Open the certificate on your iOS device
1. **Tap "Install"** in the top right corner
2. **Enter your passcode** when prompted
3. **Tap "Install"** again to confirm the warning
4. **Tap "Done"** when complete

## Step 3: Enable Certificate Trust (Critical!)

1. **Settings** → **General** → **About** → **Certificate Trust Settings**
2. **Find your certificate** (listed by hostname like "192.168.3.2")
3. **Toggle the switch to ON**
4. **Tap "Continue"** in the warning

## Step 4: Configure AliasVault App

1. **Open the AliasVault app**
2. **Go to Settings** → **Server Configuration**
3. **Enter your server URL**: `https://192.168.3.2/api` (use your configured hostname)
4. **Test connection** - should work without SSL errors

## Troubleshooting

**SSL errors**: Ensure you completed Step 3 (Certificate Trust) - this is the most commonly missed step

**Certificate Trust Settings not visible**: You must install a certificate profile first

**App can't connect**: Verify the hostname in the app matches your server configuration exactly