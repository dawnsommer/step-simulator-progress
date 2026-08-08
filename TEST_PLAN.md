# TEST-7 Acceptance Plan

## Authentication — must be exercised on deployed GitHub Pages

1. Connect Google once. Confirm redirect uses the shared Worker and returns to `https://dawnsommer.github.io/step-simulator-progress/#cloud-auth=...`.
2. Confirm the fragment disappears immediately after app load.
3. Reload. Confirm no Google consent prompt and cloud manifest access succeeds.
4. Close/reopen Safari and installed PWA. Confirm no Google consent prompt while the Worker session remains valid.
5. Leave the app open long enough for the Google access token to expire (or force a 401 in diagnostics) and confirm one silent Worker refresh/retry succeeds.
6. Disconnect on one device. Confirm the other device remains connected and Drive files/local IndexedDB are untouched.

## Progress

7. Back up a form with answers, flags, stem/explanation highlights, strikeouts, attempts/results and a 3-digit score. Restore and verify them.
8. Change only one form. Confirm only that form file plus the small manifest changes in Drive.
9. Change two forms. Confirm only those two form backups change.
10. Make no progress changes, reopen/foreground the app, and confirm no form file is rewritten unnecessarily.
11. Create an unexpected local/cloud lineage divergence on two devices. Confirm automatic overwrite stops and the UI requires a direction.
12. Clear local progress without deleting source forms. Confirm cloud backups remain available for explicit recovery and are not interpreted as mass deletion.
13. Verify bankHash mismatch blocks applying progress to a different form version.

## Offline/local safety

14. Block Worker connectivity. Confirm simulator answers/highlights/local progress continue normally.
15. Block Drive connectivity. Confirm simulator continues locally and dirty progress stays pending.
16. Use the app fully offline, then reconnect. Confirm pending progress is evaluated/uploaded without losing local state.

## Full library

17. Back up a multi-file library. Confirm payload requests go directly to Google Drive upload endpoints, not through the Worker.
18. Pause/resume/cancel upload and download.
19. Complete a restore and confirm obsolete non-progress library files are removed rather than accumulated, while progress remains present.
20. On fresh iPad/PWA, Restore Library first, then Restore Progress; verify matching `formId + bankHash` progress reattaches.

## Static/automated tests performed in the build workspace

See the completion report supplied with the ZIP. Real Google OAuth/Drive/PWA tests require the deployed origin and a user Google session and are not claimed as completed locally.
