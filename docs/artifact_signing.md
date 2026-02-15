# Windows Code Signing with Azure Artifact Signing

Azure Artifact Signing (formerly Trusted Signing) is Microsoft's managed code signing service. It eliminates the "unknown publisher" SmartScreen warning on Windows installers without needing a traditional EV certificate or USB token.

## Why This Over Traditional Certificates

| | Azure Artifact Signing | Traditional EV Cert |
|---|---|---|
| Cost | ~$120/year ($9.99/mo Basic) | $300-600/year |
| SmartScreen | Immediate trust (Microsoft-issued) | Immediate trust (EV) |
| Hardware token | None (keys in Azure HSM) | USB token required |
| CI/CD integration | Native GitHub Action | Manual signtool + token |
| Certificate renewal | Automatic (3-day rotating certs, timestamped) | Manual, annual |

Basic plan includes 5,000 signatures/month -- more than enough for CI releases.

## Setup

### 1. Azure Account

- Sign up at https://azure.microsoft.com/free
- Set subscription to pay-as-you-go (no charge beyond the signing service)

### 2. Create Trusted Signing Account

- Azure Portal -> search "Trusted Signing" (or "Artifact Signing")
- Create account in your subscription, pick a region
- Note the **Account URI** (e.g. `https://eus.codesigning.azure.net/`)

### 3. Create App Registration (API Credentials for CI)

- Azure Portal -> "App Registrations" -> New
- Record:
  - **Client ID** -> `AZURE_CLIENT_ID`
  - **Tenant ID** -> `AZURE_TENANT_ID`
- Add a client secret (24-month expiry) -> copy the **value** (not the ID) -> `AZURE_CLIENT_SECRET`

### 4. Assign Roles

Two role assignments needed in the Trusted Signing Account -> Access Control (IAM):

1. Your Azure user account -> **Trusted Signing Identity Verifier** (needed to create identity validation)
2. The App Registration from step 3 -> **Trusted Signing Certificate Profile Signer** (needed for CI signing)

### 5. Identity Validation

- Trusted Signing Account -> Identity Validation -> New -> **Public Trust**
- Fill in business details (Tax ID or DUNS number, domain-based email)
- Both primary and secondary email must share the same domain
- Validation usually completes within minutes to hours
- Expires after 2 years

### 6. Create Certificate Profile

- Create a **Public Trust** certificate profile
- Select your verified identity
- Note the **Certificate Profile Name**

## GitHub Actions Integration

### Secrets to Add

Add these 6 secrets at `github.com/zsazsa/lefauxpain` -> Settings -> Secrets -> Actions:

| Secret | Value |
|--------|-------|
| `AZURE_TENANT_ID` | From App Registration |
| `AZURE_CLIENT_ID` | From App Registration |
| `AZURE_CLIENT_SECRET` | App Registration secret value |
| `AZURE_ENDPOINT` | Account URI (e.g. `https://eus.codesigning.azure.net/`) |
| `AZURE_CODE_SIGNING_NAME` | Trusted Signing Account name |
| `AZURE_CERT_PROFILE_NAME` | Certificate Profile name |

### Workflow Changes (`.github/workflows/publish.yml`)

Add a signing step after `tauri-action` for the Windows build:

```yaml
- name: Sign Windows artifacts
  if: matrix.platform == 'windows-latest'
  uses: azure/trusted-signing-action@v0.3.16
  with:
    azure-tenant-id: ${{ secrets.AZURE_TENANT_ID }}
    azure-client-id: ${{ secrets.AZURE_CLIENT_ID }}
    azure-client-secret: ${{ secrets.AZURE_CLIENT_SECRET }}
    endpoint: ${{ secrets.AZURE_ENDPOINT }}
    trusted-signing-account-name: ${{ secrets.AZURE_CODE_SIGNING_NAME }}
    certificate-profile-name: ${{ secrets.AZURE_CERT_PROFILE_NAME }}
    files-folder: ${{ github.workspace }}/desktop/src-tauri/target/release/bundle/nsis/
    files-folder-filter: exe
```

Alternatively, configure Tauri to sign during build by setting `signCommand` in `tauri.conf.json` under `bundle.windows`. This signs the exe before bundling into the installer.

## How It Works

1. CI builds the Tauri app (unsigned)
2. The signing action authenticates to Azure via the App Registration credentials
3. Only a **digest** (hash) is sent to Azure -- the actual binary never leaves the runner
4. Azure signs the digest with a Microsoft-issued certificate stored in FIPS 140-2 Level 3 HSMs
5. The signature + timestamp are applied to the binary
6. Certificates rotate automatically every 3 days; timestamping ensures signatures remain valid indefinitely

## Common Issues

| Error | Cause | Fix |
|-------|-------|-----|
| 403 Forbidden | Missing role assignment | Check App Registration has "Certificate Profile Signer" role |
| `AADSTS7000215` | Copied secret ID instead of value | Recreate secret, copy the **value** column |
| "No certificates found" | DLL path or bitness mismatch | Use x64 signtool + x64 Dlib; verify .NET 6.0+ is installed |
| Identity validation stuck | Missing docs or email domain mismatch | Ensure both emails share the same domain |

## References

- [Azure Artifact Signing Overview](https://learn.microsoft.com/en-us/azure/artifact-signing/overview)
- [Azure Artifact Signing Pricing](https://azure.microsoft.com/en-us/pricing/details/artifact-signing/)
- [Melatonin: Code signing with Azure Trusted Signing](https://melatonin.dev/blog/code-signing-on-windows-with-azure-trusted-signing/)
- [Rick Strahl: Setting up Trusted Signing](https://weblog.west-wind.com/posts/2025/Jul/20/Fighting-through-Setting-up-Microsoft-Trusted-Signing)
- [azure/trusted-signing-action](https://github.com/azure/trusted-signing-action)
