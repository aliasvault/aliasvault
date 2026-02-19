---
layout: default
title: Windows development
parent: Development
grand_parent: Miscellaneous
nav_order: 2
---


# Setting Up AliasVault Development Environment on Windows

This guide will help you set up AliasVault for development on Windows using WSL (Windows Subsystem for Linux).

## Prerequisites

1. **Install WSL**
   - Open PowerShell as Administrator and run:
     ```powershell
     wsl --install
     ```
   - This will install Ubuntu by default
   - Restart your computer after installation

2. **Install Visual Studio 2022**
   - Download from [Visual Studio Downloads](https://visualstudio.microsoft.com/downloads/)
   - Required Workloads:
     - ASP.NET and web development
     - .NET WebAssembly development tools
     - .NET cross-platform development

3. **Install .NET 10 SDK**
   - Download from [.NET Downloads](https://dotnet.microsoft.com/download/dotnet/10.0)
   - Install both Windows and Linux versions (you'll need both)

## Setup Steps

1. **Clone the Repository**
   ```bash
   git clone https://github.com/aliasvault/aliasvault.git
   cd aliasvault
   ```
2. **Configure WSL**
   - Open WSL terminal
   - Edit WSL configuration:
     ```bash
     sudo nano /etc/wsl.conf
     ```
   - Add the following configuration:
     ```ini
     [automount]
     enabled = true
     options = "metadata,umask=22,fmask=11"
     mountFsTab = false

     [boot]
     systemd=true
     ```
   - Save the file (Ctrl+X, then Y)
   - Restart WSL from PowerShell:
     ```powershell
     wsl --shutdown
     ```

3. **Setup Development Database**
   - Open a new WSL terminal in the AliasVault directory
   - Run the development database setup:
     ```bash
     ./install.sh configure-dev-db
     ```
   - Select option 1 to start the development database
   - Verify the database is running:
     ```bash
     docker ps | grep postgres-dev
     ```

4. **Run the Application**
   - Open the solution in Visual Studio 2022
   - Set WebApi as the startup project
   - Press F5 to run in debug mode

## Troubleshooting

### Database Connection Issues
If the WebApi fails to start due to database connection issues:

1. **Check Database Status**
   ```bash
   docker ps | grep postgres-dev
   ```

2. **Check Database Logs**
   ```bash
   docker logs aliasvault-dev-postgres-dev-1
   ```

3. **Permission Issues**
   If you see permission errors, try:
   ```bash
   sudo mkdir -p ./database/postgres
   sudo chown -R 999:999 ./database/postgres
   sudo chmod -R 700 ./database/postgres
   ```

4. **Restart Development Database**
   ```bash
   ./install.sh configure-dev-db
   # Select option 2 to stop, then option 1 to start again
   ```

### WSL Issues
If you experience WSL-related issues:

1. Make sure you have the latest WSL version:
   ```powershell
   wsl --update
   ```

2. Verify WSL is running correctly:
   ```powershell
   wsl --status
   ```

3. If problems persist, try resetting WSL:
   ```powershell
   wsl --shutdown
   wsl
   ```

## Additional Notes

- Always run the development database before starting the WebApi project
- Make sure you're using the correct .NET SDK version in both Windows and WSL
- If you modify the WSL configuration, always restart WSL afterward
- For best performance, store the project files in the Linux filesystem rather than the Windows filesystem

## Support

If you encounter any issues not covered in this guide, please:
1. Check the [GitHub Issues](https://github.com/aliasvault/aliasvault/issues)
2. Search for existing solutions
3. Create a new issue if needed
