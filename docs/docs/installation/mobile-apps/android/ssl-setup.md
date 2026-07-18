---
sidebar_position: 3
sidebar_label: "Self-Signed SSL Setup"
---
# Self-Signed SSL Certificate Setup for Android

By default, the AliasVault Android app only supports connecting to servers with a valid SSL certificate from a trusted external authority. If you want to use your own self-signed certificate, you must manually install and trust the certificate on your Android device by following these steps.

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
1. Open Chrome, go to your AliasVault instance (e.g., `https://192.168.3.2`)
2. Click the padlock icon → inspect certificate
3. Export the certificate and send it to your phone

### Option B: From Server
Copy from your AliasVault installation directory:
```bash
cp [aliasvault-install-dir]/certificates/ssl/cert.pem ~/aliasvault.crt
```
Transfer to your Android device.

## Step 2: Install Certificate (Android 10+)

1. **Open Settings** → search for "Certificate"
2. **Tap "Install a certificate"** → **"CA certificate"**
3. **Browse to Downloads** → select your certificate file
4. **Enter your PIN/password** when prompted
5. **Name it "AliasVault"** and tap **OK**

## Step 3: Configure AliasVault App

1. **Open the AliasVault app**
2. **Go to Settings** → **Server Configuration**
3. **Enter your server URL**: `https://192.168.3.2/api` (use your configured hostname)
4. **Test connection** - should work without SSL errors

## Troubleshooting

**Certificate not trusted**: Verify it's installed under Settings → Security → Trusted credentials → User tab

**App can't connect**: Ensure the hostname in the app matches your server configuration exactly

**Installation fails**: Make sure you have a screen lock set up on your device