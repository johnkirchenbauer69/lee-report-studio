# GitHub Push Commands — VS Code

## 1. Unzip and open the folder

In VS Code:

**File → Open Folder → `lee-report-studio`**

Open a terminal with **Terminal → New Terminal**.

## 2. Install and verify

```bash
npm install
npm run typecheck
npm run build
npm run dev
```

Open the localhost URL printed by Vite and test the editor.

## 3. Stop the dev server

In the terminal running Vite press:

```text
Ctrl+C
```

## 4. Initialize Git

```bash
git init
git add .
git commit -m "Initial LEE Report Studio MVP"
git branch -M main
```

## 5. Create an empty GitHub repo

Example repo name:

```text
lee-report-studio
```

For the cleanest push, create it without a GitHub-generated README, `.gitignore`, or license.

## 6. Attach the remote

Replace the URL below with the new repository URL:

```bash
git remote add origin https://github.com/YOUR-USERNAME-OR-ORG/lee-report-studio.git
```

Confirm:

```bash
git remote -v
```

## 7. Push

```bash
git push -u origin main
```

## Subsequent pushes

```bash
git add .
git commit -m "Describe the change"
git push
```

## If the GitHub repo was already initialized with files

Before the first push:

```bash
git pull origin main --rebase
```

Resolve any conflict if necessary, then:

```bash
git push -u origin main
```

## Recommended first GitHub milestone after this upload

1. Pin dependency versions and commit `package-lock.json`.
2. Add the current production Industrial Market Report assets/template.
3. Define the exact normalized `IndustrialMarketReportData` contract.
4. Connect the existing Ascendix Overall Market Table payload.
5. Implement repeating submarket page generation.
6. Add server-side PDF rendering.
