# Midnight Network Developer Guide

> [!IMPORTANT]
> The information in this guide is synthesized from developer session transcripts and verified against official sources. As the Midnight Network is in active development, specific versions (e.g., Compact v0.27) and commands may evolve. Always cross-reference with the [official Midnight documentation](https://docs.midnight.network/).

## 1. Overview
The Midnight Network enables developers to build privacy-preserving decentralized applications (DApps) using the **Compact** smart contract language. A typical development workflow involves three phases:
1.  **Logic Phase**: Developing and testing contracts locally.
2.  **Integration Phase (Undeployed Network)**: Running a local network stack (Node, Proof Server, Indexer) to test integration.
3.  **Testnet Phase (Preview Network)**: Deploying to the public "Preview" testnet for wider meaningful interacting.

## 2. Prerequisites & Setup
To get started, ensure your environment handles the following dependencies:

| Tool | Purpose | Note |
| :--- | :--- | :--- |
| **Node.js** | Runtime Environment | Version 18+ or 20.x recommended. |
| **Docker** | Containerization | Required for running local network instances (Proof Server, etc.). |
| **Lace Wallet** | Browser Wallet | Required for transaction signing. [Download Lace](https://www.lace.io/). |
| **Compact** | Compiler | The Midnight smart contract language. |

> [!NOTE]
> **Compact Versioning**: The transcript highlights a need to manually manage Compact versions (specifically mentioning v0.27). Ensure you are using the version compatible with the starter kit.

## 3. The Starter Template
The quickest way to start is using the **Midnight Starter Template** (similiar to `MeshJS/midnight-starter-template`). This template is AI-friendly and modular.

### Structure
The template is organized into three main directories, promoting a clean separation of concerns:
-   **`contract/`**: Contains **Compact** smart contracts and logic.
-   **`cli/`**: Command Line Interface scripts for deploying and interacting with contracts without a UI.
-   **`react/`** (or `frontend-vite-react/`): A Vite + React frontend application for the DApp UI.

### Installation
1.  **Clone/Scaffold**: Use `create-mn-app` or clone the repository.
    ```bash
    git clone https://github.com/MeshJS/midnight-starter-template.git
    cd midnight-starter-template
    ```
2.  **Install Dependencies**:
    ```bash
    npm install
    ```
3.  **Build Project**:
    Compiles contracts and builds the application.
    ```bash
    npm run build
    ```

### Configuration (.env)
You will need to configure environment variables for both the CLI and Frontend.
*   **CLI**: Update `cli/.env` with your wallet mnemonics.
*   **Frontend**: Update `react/.env` with deployed contract addresses.

## 4. Development Workflows

### A. Local Development ("Undeployed Network")
This mode runs the entire stack locally, removing dependencies on public testnets. It is ideal for rapid iteration.

1.  **Start Local Instances**:
    Boot up the local Node, Proof Server, and Indexer.
    ```bash
    npm run standalone-start
    # OR equivalent command from the specific starter kit's package.json
    ```
2.  **Fund Local Wallet**:
    The local network comes with pre-funded genesis accounts, but you may need to run a setup script to fund your specific development wallet.
    ```bash
    # Example command based on transcript
    npm run setup-standalone
    ```
    *This usually spins up instances AND funds the wallet defined in your environment variables.*

3.  **Generate "Dust"**:
    *   **Concept**: **Night** is the governance token, **Dust** is the "gas" token.
    *   **Action**: You must hold Night to generate Dust. In the local environment, delegate your massive "Night" balance (e.g., 1 Billion) to a dust generator to quickly accrue Dust for transactions.

### B. Testnet Development ("Preview Network")
This mode connects your DApp to the public Midnight Preview Testnet.

1.  **Connect Wallet**: Open Lace Wallet and switch the network to **Preview**.
2.  **Sync**: Wait for the wallet to sync.
3.  **Acquire Funds**: Use the [Midnight Testnet Faucet](https://faucet.midnight.network/) if you don't have tNIGHT.
4.  **Run Frontend**:
    ```bash
    npm run dev
    ```
    *   **Note**: On Preview, the Proof Server is managed publicly (often abstracted by Lace), so you don't need to run local Docker instances for proofs.

## 5. Tokenomics: Night vs. Dust
Understanding the dual-token model is crucial for development:

*   **NIGHT**: The unshielded, native asset. Used for governance and consensus. **Holding NIGHT generates DUST.**
*   **DUST**: The shielded, private asset. Used as "gas" to pay for transactions. You cannot buy Dust directly; you must accrue it by holding/delegating Night.

> [!TIP]
> **Gaming Use Case**: The transcript suggests interesting game mechanics using this model (e.g., Dust as "Mana" that regenerates over time based on your held Night).

## 6. Smart Contract Deployment
1.  **Deploy**: Use the CLI tools to deploy your compiled Compact contract.
    ```bash
    # From the CLI directory
    npm run deploy
    ```
2.  **Update Frontend**: Copy the resulting Contract Address.
3.  **Configure**: Paste the address into your `react/.env` file so the UI knows which contract to talk to.
