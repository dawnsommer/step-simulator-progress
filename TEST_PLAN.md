# TEST-5 Backup Test Plan

## Progress
1. Back up a form with answers, stem/explanation highlights, marks and a 3-digit score. Restore it and verify all fields including the 3-digit score.
2. Change only the 3-digit score and confirm only that form becomes pending.
3. Modify only Form A and confirm Form B's backup lineage remains unchanged.
4. Delete/reset local Form A progress and confirm its cloud recovery copy remains available.
5. Verify `bankHash` mismatch blocks restore.

## Full library
6. Press **Back Up Library** with several forms/assets. Confirm a separate library manifest is created and progress files are excluded.
7. Verify the progress bar shows percent, MB/total, current file, speed and ETA.
8. Pause during upload, then Resume. Confirm it continues rather than starting a new committed backup.
9. Cancel an upload. Confirm the previous committed library manifest remains restorable.
10. Start upload, close/reopen the test app, reconnect Google if needed, and Resume the interrupted transfer.
11. On another/fresh browser, press **Restore Library**. Confirm forms/assets/catalog load directly into the browser library without downloading a ZIP through the Files app.
12. Pause and Resume a library restore.
13. Interrupt a restore before `catalog.json`; confirm the existing active catalog is not replaced prematurely.
14. Complete restore and confirm catalog/forms/assets are available, then separately Restore Progress and verify progress reattaches to matching `formId + bankHash`.

## Safety
15. Confirm ordinary question answers/highlights do not trigger full-library uploads.
16. Confirm the old V3 monolithic progress file remains ignored.
17. Confirm TEST-5 cache/IndexedDB/service-worker namespaces remain isolated from production.
