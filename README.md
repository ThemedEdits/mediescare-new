# Mediescare

Offline-first pharmacy point of sale and management for a pharmacy chain: one Head Office and many branches.
It runs on Windows. Each computer keeps working without the internet and shares its data with the others over the
shop network and the cloud.

## Download and install

Get the latest installer from **[Releases](https://github.com/ThemedEdits/mediescare-new/releases/latest)**
(`Mediescare-Setup-<version>.exe`). Step-by-step instructions are in [docs/INSTALL.md](docs/INSTALL.md).

Installed copies update themselves: when a new version is released, **Update** appears in the top bar.

## Documentation

| Document | For |
|---|---|
| [Installing Mediescare](docs/INSTALL.md) | Setting up a computer |
| [User manual](docs/USER-MANUAL.md) | Everyone who uses the app, every screen step by step |
| [Cashier quick-start](docs/cashier-quick-start.md) | The counter, on one page |
| [Administrator guide](docs/admin-guide.md) | Owners and branch managers |
| [Final testing checklist](docs/TESTING-CHECKLIST.md) | Testing on several computers before going live |
| [System manual](docs/SYSTEM-MANUAL.md) | Developers: stack, hosting, database, sync, security, build, operations |
| [Releasing and updates](docs/RELEASING.md) | Developers: shipping a new version |
| [Moving data from another program](docs/legacy-migration.md) | One-time data migration |
| [Cloud gateway](gateway/README.md) | Developers: the Cloudflare Worker in front of Turso |

## For developers

```
npm install        # dependencies and the prebuilt SQLite module for Electron
npm start          # run from source
npm test           # backend tests
npm run test:ui    # headless screen test
npm run dist       # build an installer without publishing
npm run ship       # tests, new version, tag and push; GitHub Actions publishes the release
```

To connect a source build to the cloud, set `MEDIESCARE_CLOUD_URL` before `npm start`. See the
[system manual](docs/SYSTEM-MANUAL.md) for the details.
