# Releasing Mediescare and shipping updates

How a code change reaches every installed copy:

```
change code -> commit -> npm run ship -> tag v1.2.3 pushed -> GitHub Actions builds the installer
            -> GitHub Release published -> installed apps find it within an hour -> "Update" in the top bar
            -> Restart and update (or close the app) -> new version, data kept, migrations run with a safety copy
```

## One-time setup (repository owner)

GitHub Actions needs the cloud settings to build installers that connect to the cloud. Only the repository owner
(or an admin) can add them:

1. Open **https://github.com/ThemedEdits/mediescare-new/settings/secrets/actions**.
2. Click **New repository secret** and add:

   | Name | Value |
   |---|---|
   | `MEDIESCARE_CLOUD_URL` | `https://mediescare-gateway.mediescare.workers.dev` |
   | `MEDIESCARE_CLOUD_SETUP_KEY` | the gateway's `SETUP_KEY` (the same one set with `wrangler secret put SETUP_KEY`) |

3. In **Settings > Actions > General > Workflow permissions**, make sure **Read and write permissions** is selected (so
   the workflow can publish releases).

Without these secrets the workflow stops with a clear message, and nothing is published.

## Shipping an update (every time)

1. Make the change, run `npm test` (and `npm run test:ui` for screen changes).
2. Commit it: `git add -A` then `git commit -m "what changed"`.
3. Run:
   ```
   npm run ship
   ```
   - It runs the backend tests.
   - It raises the version (1.0.0 to 1.0.1), commits and tags it (`v1.0.1`), and pushes.
   - Use `npm run ship -- minor` for 1.1.0 or `npm run ship -- major` for 2.0.0.
4. Watch **https://github.com/ThemedEdits/mediescare-new/actions**. In about 10 minutes the release appears under
   **Releases** with `Mediescare-Setup-1.0.1.exe`, its `.blockmap` and `latest.yml`.
5. Installed copies check every hour (and 30 seconds after they start). Managers can press **Check now** on Help and
   updates to see it at once.

## Releasing from a developer's computer instead

When GitHub Actions is not set up, publish from your own computer (PowerShell):

```
$env:MEDIESCARE_CLOUD_URL = "https://mediescare-gateway.mediescare.workers.dev"
$env:MEDIESCARE_CLOUD_SETUP_KEY = "<the gateway SETUP_KEY>"
$env:GH_TOKEN = "<a GitHub token with repo access>"
npm run release
```

The release repository is fixed in `package.json` (build.publish). The version in `package.json` must be new (higher than the last release), or installed copies will not update.

## Rules

- **Never lower the version** and never re-use a version number: updates only go upwards.
- **Database changes are new migration files only** (`src/main/db/migrations/NNN_name.js`). Never edit a migration
  that was already released. Installed copies run the new ones at start, after a safety copy.
- `npm run dist` builds an installer for testing without publishing anything.
- An installer built without `MEDIESCARE_CLOUD_URL` cannot reach the cloud. `npm run release` refuses to publish one.
