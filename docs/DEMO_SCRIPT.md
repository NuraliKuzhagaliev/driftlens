# Demo script (target 2:30)

**0:00–0:20 — The problem.** “A checkout API works locally, but its payment key never reaches the setup instructions or the deployment container. A late failure costs debugging and rework.”

**0:20–0:55 — Show live scan.** Open the hosted app. Run the release gate. Point to HOLD and the two blockers for `PAYMENT_API_KEY`. Open the source and contract tabs to show that the key is truly required, then the two missing file locations.

**0:55–1:40 — Repair and verification.** Click Apply suggested repair. Show READY and zero blockers. Open the edited `.env.example` and `compose.yaml` tabs. Download the JSON report. Change a required key in the contract, scan again to prove the detector is live. Reload the broken sample.

**1:40–2:10 — Bob contribution.** In IBM Bob IDE show the actual Agent task, files changed by Bob, the real CLI gate run, and the task session summary. Show the failure exit code on broken fixtures and success after repair if the CLI task was completed.

**2:10–2:30 — Impact and limits.** “Two concrete blockers become zero after two edits. This prototype makes the release decision reproducible. It checks static config consistency; runtime secrets and service health remain outside its scope.”

Capture the video as an MP4 with narration. Ensure at least 90 seconds of the video shows the running solution, not slides.
