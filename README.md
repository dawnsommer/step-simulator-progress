# step-simulator-progress — isolated Google Progress Sync test build

This repository is a protected experiment derived from the uploaded Step Exam Simulator A22.14 iPad/GitHub Pages build.

## Upload target

Create a GitHub repository named exactly:

`step-simulator-progress`

Upload the **contents of this ZIP directly to the repository root**, so `index.html`, `sw.js`, `manifest.webmanifest`, `privacy.html`, `js/`, `icons/`, and `ui_icons/` are at the top level.

Enable GitHub Pages for the repository. The expected site is:

`https://dawnsommer.github.io/step-simulator-progress/`

Privacy policy URL for Google branding:

`https://dawnsommer.github.io/step-simulator-progress/privacy.html`

## Google OAuth setup

This build does not contain a client secret and does not hard-code a Google OAuth Client ID.

Open the test site → **Settings** → **Google Progress Sync — TEST LAB** and paste your existing Google OAuth **Web Client ID**. The Client ID is public application identification and is stored only in this test build's isolated sync-metadata database.

For a Google OAuth Web Client, the authorized JavaScript origin is the origin, not the repository path:

`https://dawnsommer.github.io`

The requested scope is only:

`https://www.googleapis.com/auth/drive.appdata`

## Isolation from exam-simulator2

The test build intentionally uses:

- IndexedDB library: `StepSimulatorProgress_TEST_BrowserLibrary_DB`
- DATA-handle DB: `StepSimulatorProgress_TEST_DATA_Handle_DB`
- sync metadata DB: `StepSimulatorProgress_SYNC_META_TEST_DB`
- different localStorage save/settings keys
- service-worker cache prefix: `step-simulator-progress-`
- Drive file: `step-simulator-progress.TEST.progress.sync.json`
- repository/service-worker scope: `/step-simulator-progress/`

The test build's **Update App / Clear Cache** behavior is patched to delete only test-build caches and unregister only the `/step-simulator-progress/` service worker. It must not enumerate-delete production caches or production service workers.

## Important recovery behavior

Progress Sync uploads **progress, not source form files**.

After completely clearing Safari/browser site data, imported form JSON/ZIP files are gone too. Re-import the matching form files, then connect the same Google account. Progress is restored only when the local form's stable `formId + bankHash` matches the cloud progress version.

A different bank hash is not overwritten.

## Safety architecture

1. Existing simulator storage remains primary.
2. Sync reads/writes through a narrow `StepExamSyncBridge`; the exam engine's storage format is not replaced.
3. Every local progress write marks cloud state dirty, but normal question navigation does not require Google.
4. Cloud synchronization is bidirectional and uses three-way merge against the device's last successfully materialized base snapshot.
5. Form identities are keyed by `formId + bankHash`.
6. Attempts are merged by `attemptId`; Qbank tests by `qbankTestId`; indexed question arrays merge by index; highlight/strikethrough sets use base-aware set merging; answer-change logs are unioned.
7. Explicit progress deletion on a loaded form becomes a tombstone and can propagate without treating an uninstalled form as deleted.
8. Before applying a cloud merge locally, the test build stores a pre-sync recovery checkpoint in the isolated sync metadata DB.
9. After applying a merge, the build re-reads local simulator progress and verifies it against the expected merged snapshot. On verification failure it automatically restores the pre-sync checkpoint and does not upload the failed merge.
10. While an exam is actively open, cloud reconciliation is not written back into the active simulator state. The cloud checkpoint may be updated, but full local reconciliation is deferred until a safe non-exam state.
11. Authentication errors and merge/storage errors remain separate. HTTP 401 clears only the ephemeral token; HTTP 403 does not automatically disconnect Google.
12. Normal Disconnect does not revoke the Google grant and does not delete local or Drive data.

## First test sequence

1. Open the test site and import 2–3 forms.
2. Make recognizable progress: answers, flags, strikethroughs, stem highlights, explanation highlights, notes, and a completed block/form.
3. Go to Settings → Google Progress Sync — TEST LAB.
4. Click **Validate Local Progress**. Confirm Round-trip: PASS and inspect the counts.
5. Save your Web Client ID and connect Google.
6. Confirm the account shown is the intended Gmail and status becomes Synced.
7. Open the same test site on another device, import the same form file(s), paste the same Web Client ID, connect the same Gmail, and sync.
8. Compare answers, highlights, flags, notes, results, attempts, and Qbank data.
9. Test independent edits on different questions/devices.
10. Only after the test build survives those cases should the sync code be considered for production `exam-simulator2`.

## Test-only recovery tool

Settings includes **Restore Last Pre-Sync Checkpoint**. It is blocked while an exam is active. It restores only the latest automatic local checkpoint inside the test build and then marks progress dirty so you can decide whether to sync it.

## TEST-2 UI update

- Google Progress Sync now has its own top-level **Progress Sync** tab.
- The Google OAuth Web Client ID is preconfigured in `js/sync-config.js`; there is no Client ID field or save control in the UI.
- Connected state shows the authorized Google account, sync status, last successful sync, **Sync Now**, and **Disconnect**.
- The Connect button appears only while disconnected; expired authorization shows **Reconnect Google** instead.
- PWA/service-worker build identifier: `STEP-PROGRESS-TEST-2`.
