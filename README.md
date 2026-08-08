# step-simulator-progress — TEST-5

Isolated GitHub Pages test build for local-first Google progress backup plus optional full form-library backup.

## Test URL

Repository name must remain `step-simulator-progress` so the deployed base path is:

`https://dawnsommer.github.io/step-simulator-progress/`

Upload the contents of this ZIP to the repository root, then enable GitHub Pages.

## Progress backup

- Existing simulator IndexedDB remains the immediate working database.
- Routine answers/highlights/flags/notes/timing save locally only.
- Drive `appDataFolder` stores one hidden progress backup per form/version, one Qbank backup, and tiny `step-simulator-progress.TEST.manifest.json`.
- Major checkpoints and **Back Up Now** upload only changed progress entities when lineage is safe.
- **Restore from Cloud** is explicit; cloud never silently overwrites local progress.
- `formId + bankHash` guards restores.
- The manually entered **3-digit score is part of that form's progress backup** and changing it marks only that form dirty.

## Full Form Library Backup

A second, manual-only system backs up the source library separately from progress:

- `catalog.json`
- `forms/**`
- `assets/**` and other non-progress DATA files
- excludes `progress/**` because progress uses the per-form backup system above

Cloud library metadata is stored in `step-simulator-progress.TEST.library.manifest.json`. Library files are hidden appDataFolder objects referenced by that manifest.

Large transfers are chunked and show overall progress, current file, transferred bytes, speed, ETA, **Pause / Resume / Cancel**. Transfer state is persisted locally so an interrupted transfer can be resumed after reopening and reconnecting Google.

Uploads are transactional: changed files are uploaded as new Drive objects and the new library manifest is committed only after all required files succeed. The previous committed manifest therefore remains usable if an upload is interrupted.

Restores download directly from Drive into the simulator's browser library/IndexedDB. `catalog.json` is restored last so an interrupted restore does not prematurely switch the active catalog. No iPad Files-app download is required.

## Isolation

TEST-5 keeps separate test IndexedDB/localStorage/cache/Drive namespaces and does not touch production `exam-simulator2`.

## Google OAuth

The provided public Web Client ID is embedded in `js/sync-config.js`. Only `https://www.googleapis.com/auth/drive.appdata` is requested.

Build: `STEP-PROGRESS-TEST-5`
