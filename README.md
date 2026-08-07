# step-simulator-progress — TEST-4

Isolated GitHub Pages test build for local-first per-form Google Drive progress backup.

## Test URL

Repository name must remain `step-simulator-progress` so the deployed base path is:

`https://dawnsommer.github.io/step-simulator-progress/`

Upload the contents of this ZIP to the repository root (not inside an extra folder), then enable GitHub Pages.

## TEST-4 backup model

- The simulator's existing IndexedDB remains the immediate working database.
- Routine answers, highlights, flags, notes, timing, etc. save locally only.
- Google Drive `appDataFolder` contains:
  - one tiny `step-simulator-progress.TEST.manifest.json`
  - one hidden backup JSON per form/version
  - one hidden `QBANK.progress.backup.json` when Qbank progress exists
- Major checkpoints (submit/end/return from a completed session), app startup when authorization is available, and **Back Up Now** can upload locally changed backup files.
- Only files whose cloud lineage is still the one this device expects are uploaded automatically.
- If the same cloud backup changed elsewhere, TEST-4 stops and shows **Backup decision required**. Nothing is overwritten until the user explicitly chooses **Replace Cloud with This Device** or **Restore from Cloud**.
- Cloud progress is never automatically applied to local storage.
- Local deletion/reset never automatically deletes a cloud backup. If new progress later appears for that reset form, replacing the older cloud recovery copy requires an explicit decision.
- Restore creates a local recovery checkpoint first and rolls back if application fails.
- Progress is guarded by `formId + bankHash`.

## Isolation from production

TEST-4 continues to use isolated test IndexedDB/localStorage/cache identifiers and an isolated Drive manifest/backup namespace. It does not use the old V3 monolithic snapshot for synchronization, and it does not touch the production `exam-simulator2` repository/cloud namespace.

## Google OAuth

The provided public Web Client ID is embedded in `js/sync-config.js`. There is no Client ID input or save control in the UI. Only `https://www.googleapis.com/auth/drive.appdata` is requested.

Build: `STEP-PROGRESS-TEST-4`
