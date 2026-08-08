# step-simulator-progress — TEST-7 Worker OAuth

Isolated GitHub Pages test build for local-first Step Exam Simulator progress backup.

## Deployment

Repository: `step-simulator-progress`

Production test URL:

`https://dawnsommer.github.io/step-simulator-progress/`

Upload the contents of this ZIP to the repository root and enable GitHub Pages.

## Authentication architecture

- Shared OAuth Worker: `https://study-tools-auth-worker.summerofdawn20.workers.dev`
- `app_id`: `step-simulator-progress`
- OAuth return URL: `https://dawnsommer.github.io/step-simulator-progress/`
- The browser stores only an opaque Worker session persistently.
- Google refresh tokens remain inside the Worker.
- Short-lived Google Drive access tokens are held in memory only.
- Reload/reopen uses Worker `/token` silently when the saved Worker session remains valid.
- Drive API payloads go directly browser/iPad → Google Drive, never through Cloudflare.

Production migration is centralized in `js/sync-config.js` under `CLOUD_CONFIG`.

## Progress storage

- Main iPad library DB: `StepSimulatorProgress_TEST_BrowserLibrary_DB`, store `files`.
- Remembered DATA-folder handle DB: `StepSimulatorProgress_TEST_DATA_Handle_DB`, store `handles`.
- Sync metadata DB: `StepSimulatorProgress_SYNC_META_TEST_DB`, store `kv`.
- Library transfer temp DB: `StepSimulatorProgress_LIBRARY_TRANSFER_TEST_DB`, store `chunks`.
- IndexedDB/local DATA progress remains authoritative and saves immediately.
- One hidden Drive progress backup per form/version plus Qbank.
- Small cloud manifest: `step-simulator-progress.TEST.manifest.json`.
- 3-digit score is included in that form's progress payload.
- Routine active-exam writes mark the form dirty but do not upload a 500KB+ file for every answer/highlight.
- Major checkpoints, foreground/network restoration, manual Back Up Now, and app startup flush pending dirty forms.
- Existing backup-lineage guards remain: unexpected local/cloud divergence is not silently overwritten.

## Cloud serialization

TEST-7 has explicit `serializeForCloud()` / `restoreFromCloud()` boundaries. The current implementation is intentionally lossless and does not discard highlight anchors or other native progress fields. JSON is minified on Drive upload, but no unverified lossy deduplication is performed without representative real progress files to prove reconstruction safety.

## Full Form Library Backup

- Manual-only and separate from normal progress sync.
- Backs up catalog/forms/assets and excludes `progress/**`.
- Large file payloads transfer browser → Google Drive directly using resumable/chunked requests.
- Pause / Resume / Cancel remains available.
- Restore writes directly into the IndexedDB-backed iPad library.
- On successful restore, obsolete non-progress local library files not present in the cloud manifest are pruned. Progress is preserved.
- `catalog.json` remains last in restore order; interrupted restore does not begin by deleting the existing catalog.

## Build

`STEP-PROGRESS-TEST-7`
