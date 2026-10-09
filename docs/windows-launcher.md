# Windows local launcher

The launcher uses the existing built React interface and local API in one Node
process. It requires no Electron/Tauri installation and no terminal for normal
startup. It does not start Vite. Existing `.env`, templates, saved reports and
assets remain in their existing locations.

## One-time setup

Use Node.js 22 or newer with the application's configured `.env`. From this
project, double-click `scripts/windows/Install.cmd` once. It installs locked
dependencies, builds the application, and creates **Lee Report Studio.lnk** on
your Windows Desktop with a local icon. If dependencies are already installed,
run `node scripts/windows/install.mjs --skip-install` to avoid replacing `node_modules`.

Do not run dependency installation while a development server is using those
dependencies. Installation does not create or overwrite `.env`; configure the
existing app normally. Licensed font files and Salesforce credentials are not
bundled into the shortcut.

## Everyday use

1. Double-click **Lee Report Studio** on your Desktop.
2. A local launch page reports readiness, startup errors, and troubleshooting
   logs. The report editor opens automatically once the API and built interface
   respond. You can also use **Open Report Studio** on the launch page.
3. Opening the shortcut again reuses the same launch session. It does not start
   another API server.
4. Finish editing, confirm that changes are saved, then use **Stop local
   application** on the launch page. Confirm the stop dialog. An active request,
   PDF, Market Assets job, or narrative operation makes Stop return a readable
   message rather than interrupting it. Retry after the task finishes.

Closing browser tabs keeps the server running. After a successful stop, relaunch
using the shortcut. The launcher stops only its own forked API via IPC; it never
uses process-name killing or terminates unrelated Node/browser processes.

## Addresses and logs

- Launch controls: `http://127.0.0.1:8799`.
- Built application/API: `http://127.0.0.1:8787`, or the existing configured
  `PORT`. The desktop launch sets its render origin to that same local address.
- Logs: `%LOCALAPPDATA%\LeeReportStudio\<project-identifier>\launcher.log`,
  also accessible through **Troubleshooting logs**. Logs may include normal API
  diagnostics; inspect them locally before sharing.

`LEE_LAUNCH_PORT` and `LEE_LAUNCH_API_PORT` can override the control/API ports.
`LEE_DATA_DIR` is honored. Node binary and project paths are resolved during
setup; moving the project or changing Node's installation requires rerunning
setup. The launcher reads the project's existing `.env` without changing it.

## Recovery and limitations

If a normal `npm run dev` server already occupies the application port, the
launcher shows an explicit conflict and leaves that server alone. Close it
through its own controls before launching the desktop version. It does not
adopt a server it did not start. If the control port is owned by another
application/project, a Windows message identifies the conflict and log path.

When startup fails before the API starts, **Stop local application** closes the
failed launch session so you can retry after fixing setup. Startup timeout with
a still-running API requires normal Stop acknowledgment; there is no forced
termination fallback. Ordinary API failure is reported in the launch page/log.

The shortcut runs the last successful build. After source changes, rerun setup
with `--skip-install` or rebuild before launch. This is a local desktop
entry point, not an installer with automatic updates or a background Windows
service. There is no system-tray integration; control stays in the launch page.

## Verification

`node scripts/windows/verify-launcher.mjs` runs isolated mock-data launch checks
on ports 8830/8831. It checks readiness, duplicate launch, rejected untrusted
stop, graceful stop, restart, and a port conflict. Browser captures show the
launch page and built application. See [validation](ux-validation.md).
