---
layout: default
title: Linux/MacOS development
parent: Development
grand_parent: Miscellaneous
nav_order: 1
---

# Setting Up AliasVault Development Environment on Linux/MacOS

This guide will help you set up AliasVault for development on Linux or MacOS systems.

## Prerequisites

1. **Install .NET 10 SDK**
   ```bash
   # On MacOS via brew:
   brew install --cask dotnet-sdk

   # On Linux:
   # Follow instructions at https://dotnet.microsoft.com/download/dotnet/10.0
   ```

2. **Install Docker**
   - Follow instructions at [Docker Desktop](https://www.docker.com/products/docker-desktop)
   - For Linux, you can also use the native Docker daemon

## Setup Steps

1. **Clone the Repository**
   ```bash
   git clone https://github.com/aliasvault/aliasvault.git
   cd aliasvault
   ```

2. **Install dotnet CLI EF Tools**
   ```bash
   # Install dotnet EF tools globally
   dotnet tool install --global dotnet-ef

   # Add to your shell's PATH (if not already done)
   # For bash/zsh, add to ~/.bashrc or ~/.zshrc:
   export PATH="$PATH:$HOME/.dotnet/tools"

   # Verify installation
   dotnet ef
   ```

3. **Install dev database**
   ```bash
   ./install.sh configure-dev-db
   ```

4. **Run Tailwind CSS compiler**
   ```bash
   # For Admin project
   cd apps/server/AliasVault.Admin
   npm run build:admin-css

   # For Client project
   cd apps/server/AliasVault.Client
   npm run build:client-css
   ```

5. **Install Playwright for E2E tests**
   ```bash
   # Install Playwright CLI
   dotnet tool install --global Microsoft.Playwright.CLI

   # Install browsers
   pwsh apps/server/Tests/AliasVault.E2ETests/bin/Debug/net10.0/playwright.ps1 install
   ```

6. **Configure Development Settings**
   Create `wwwroot/appsettings.Development.json` in the Client project:
   ```json
   {
       "ApiUrl": "http://localhost:5092",
       "PrivateEmailDomains": ["example.tld"],
       "SupportEmail": "support@example.tld",
       "UseDebugEncryptionKey": "true",
       "CryptographyOverrideType": "Argon2Id",
       "CryptographyOverrideSettings": "{\"DegreeOfParallelism\":1,\"MemorySize\":1024,\"Iterations\":1}"
   }
   ```

7. **Install rustup & compile from Rust to WebAssembly**
   - Needed for AliasVault.Client module in case you want to run it directly from the code on your IDE (e.g. not using Docker)
   - Follow instructions at [rustup](https://rustup.rs) and install it.
   - Add `wasm32-unknown-unknown` and `wasm-pack`:
    ```bash
    # Add wasm32-unknown-unknown target to your Rust installation
    rustup target add wasm32-unknown-unknown

    # Install wasm-pack
    cargo install wasm-pack
    ```
   - Run AliasVault Rust Core Build Script:
   ```bash
   ./core/rust/build.sh --browser
   ```

## Running the Application

1. **Start the Development Database**
   ```bash
   ./install.sh configure-dev-db
   ```

2. **Run the Application**
   ```bash
   # Using dotnet CLI
   cd apps/server/AliasVault.Api
   dotnet run

   # Or using your preferred IDE (VS Code, Rider, etc.)
   ```

## Troubleshooting

### Database Issues
If you encounter database connection issues:

1. **Check Database Status**
   ```bash
   docker ps | grep postgres-dev
   ```

2. **Check Logs**
   ```bash
   docker logs aliasvault-dev-postgres-dev-1
   ```

3. **Restart Database**
   ```bash
   ./install.sh configure-dev-db
   ```

### Common Issues

1. **Permission Issues**
   ```bash
   # Fix script permissions
   chmod +x install.sh
   ```

2. **Port Conflicts**
   - Check if port 5433 is available for the development database
   - Check if port 5092 is available for the API

## Additional Notes

- Keep your .NET SDK and Docker up to date
- The development database runs on port 5433 to avoid conflicts
- Use the debug encryption key in development for easier testing
- Store sensitive data in environment variables or user secrets

## Support

If you encounter any issues not covered in this guide, please:
1. Check the [GitHub Issues](https://github.com/aliasvault/aliasvault/issues)
2. Search for existing solutions
3. Create a new issue if needed