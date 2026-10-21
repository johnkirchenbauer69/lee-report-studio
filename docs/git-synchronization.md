# Local application and GitHub synchronization

The authoritative repository is `johnkirchenbauer69/lee-report-studio`, with default branch `main`. Windows runs the application locally. GitHub stores source and history; there is no hosted application or Render deployment.

Before implementation, run `git status --short`, `git remote -v`, `git fetch origin`, and `git log --left-right --oneline HEAD...origin/main`. Confirm the remote before writing. Preserve modified and untracked files; do not use reset, clean, forced checkout, or force-push to reconcile divergence.

Use a feature branch for substantial changes. Review and integrate existing changes deliberately, grouping commits by behavior. Keep private report snapshots, fonts, generated PDFs, native packages, and local data out of Git. Record excluded local files in the handoff.

Fetch again before pushing. Integrate new upstream commits on the feature branch and resolve conflicts without dropping either side's work. Run relevant unit, build, browser, and export checks. Push the feature branch and update its pull request with tested behavior and limitations.

After the validated pull request is accepted, fetch, switch to local `main` only when doing so preserves the working tree, and run `git merge --ff-only origin/main`. If fast-forward fails, inspect and reconcile rather than resetting. Verify `git rev-parse HEAD` equals `git rev-parse origin/main`. Start the local application from that commit and verify health and browser behavior. A successful push alone is not completion.

Use Git for synchronization. Do not introduce bidirectional file synchronization. When another process changes the repository, inspect its changes, fetch, and reconcile before continuing.
