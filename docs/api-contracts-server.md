# API Contracts - Server

## Authentication (`/v1/auth`)

The authentication system uses **Secure Remote Password (SRP) protocol** to ensure zero-knowledge architecture. The server never stores the user's actual password.

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| `POST` | `/login` | Initiate SRP login. Returns `salt` and server ephemeral `public`. | ❌ |
| `POST` | `/validate` | Validate client SRP proof. Returns JWT `access_token` + `refresh_token`. | ❌ |
| `POST` | `/refresh` | Refresh expired access token using refresh token. | ❌ |
| `POST` | `/revoke` | Revoke a refresh token (logout). | ❌ |
| `POST` | `/register` | Register new user with SRP `salt` and `verifier`. | ❌ |
| `GET` | `/status` | Check authentication status and vault revision compatibility. | ✅ |
| `POST` | `/mobile-login/initiate` | Start QR-based mobile login flow. | ❌ |
| `POST` | `/mobile-login/submit` | Mobile app submits encrypted credentials. | ✅ |

### Key Auth Flows
1. **Login:** Client sends `username` -> Server returns `salt` -> Client derives private key -> Client generates `verifier` -> Client/Server exchange proofs -> Server issues JWT.
2. **Mobile Login:** Web client requests login -> Server generates Request ID -> Mobile app scans QR -> Mobile app encrypts credentials with session key -> Server relays to Web client.

---

## Vault Management (`/v1/vault`)

Handles the synchronization of encrypted vault blobs. The server treats the vault as an opaque blob.

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| `GET` | `/` | Retrieve the latest encrypted vault blob. Returns `revision_number`. | ✅ |
| `POST` | `/` | Update vault. Requires `current_revision_number` to prevent conflicts. | ✅ |
| `GET` | `/merge` | Get list of conflicting vaults for client-side resolution (Legacy). | ✅ |
| `POST` | `/change-password` | Atomically update vault blob and SRP password `verifier`. | ✅ |

### Vault Sync Logic
- **Revision Numbers:** Each update increments the `revision_number`.
- **Conflict Detection:** Updating with an old `revision_number` returns `400 Bad Request` or `Outdated` status.
- **Retention Policy:** The server keeps history: 3 recent revisions, 2 daily backups, 1 weekly, 1 monthly.

---

## Admin & Identity

*(inferred from controller list)*

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| `GET` | `/v1/identity` | Manage alias identities. | ✅ |
| `GET` | `/v1/favicon` | Proxy for retrieving service favicons (privacy-preserving). | ❌ |
