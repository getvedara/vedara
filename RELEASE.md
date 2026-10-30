# Releasing Vedara

> **Domain not registered yet.** `getvedara.dev` below is the planned site domain; nothing is live there.
> Substitute whatever domain is actually registered.

What a release consists of:

| Part | Status |
| :--- | :--- |
| **VS Code extension** (`extensions/vscode/`) | The product. Published to the VS Code Marketplace and Open VSX. |
| **Website** (`web/`) | Landing page and model list. Deployed manually until the repository is public. |
| **Desktop app** (`src/`, `src-tauri/`) | Experimental. **Not released**: no installers are published until they are code-signed. |

Vedara hosts no model weights. Models come from Ollama's registry when users run `ollama pull`.

---

## 1. VS Code extension

### Before you release

```bash
npx tsc --noEmit
npm test
npm run extensions:compile
npm run extensions:test
npm run extensions:e2e      # runs the extension inside VS Code against a stub Ollama
npm run verify:airgap
```

Then install the packaged `.vsix` in your own VS Code and try Tab completion, chat, an edit and a checkpoint restore
against a real Ollama model.

### Version and changelog

Set `version` in `extensions/vscode/package.json` (the first public release is meant to be `0.1.0`, with the
`preview` flag on) and add an entry to `extensions/vscode/CHANGELOG.md`, which the Marketplace shows as a tab.

### Package

```bash
cd extensions/vscode
npx @vscode/vsce package --no-dependencies
```

The package should contain only `out/**/*.js`, `resources/`, the README, CHANGELOG, LICENSE and `package.json`.
Check with `npx @vscode/vsce ls`.

### Publish

You need the `vedara` publisher on the [Visual Studio Marketplace](https://marketplace.visualstudio.com/manage) and the
`vedara` namespace on [Open VSX](https://open-vsx.org), each with an access token.

```bash
npx @vscode/vsce publish --no-dependencies -p <MARKETPLACE_TOKEN>
npx ovsx publish vedara-vscode-<version>.vsix -p <OPEN_VSX_TOKEN>
```

Open VSX matters: VSCodium and other VS Code builds without Microsoft's Marketplace install from there.

### Tag and GitHub release

```bash
git tag -a vscode-v<version> -m "Vedara VS Code extension <version>"
git push origin vscode-v<version>
gh release create vscode-v<version> extensions/vscode/vedara-vscode-<version>.vsix --title "Vedara for VS Code <version>" --notes-file <notes.md>
```

Use the `vscode-v` prefix: the desktop installer workflow only runs for `desktop-v*` tags, so an extension tag never
builds or publishes desktop installers.

---

## 2. Website

`.github/workflows/deploy-web.yml` builds `web/` and deploys it to GitHub Pages. GitHub Pages isn't available for
private repositories on the Free plan, so the workflow currently runs only when triggered by hand (**Actions → Deploy
Web Platform to GitHub Pages → Run workflow**). Once the repository is public, restore the commented-out `push`
trigger so pushes to `main` that touch `web/` deploy automatically.

To serve it from your own domain, set **Settings → Pages → Custom domain** and add the DNS records GitHub shows there.
Cloudflare Pages works too: build command `npm run web:build`, output directory `web/dist`.

---

## 3. Desktop app (not released)

The desktop app can be run from source (`npm run tauri dev`). `.github/workflows/release.yml` can build installers
for Windows x64 (`.msi`, `.exe`), macOS Apple Silicon (`.dmg`) and Linux x64 (`.AppImage`, `.deb`), but it doesn't
sign them, and unsigned installers trigger Windows SmartScreen and macOS Gatekeeper warnings.

Before publishing desktop installers:

1. Add code signing to the workflow: a Windows Authenticode certificate, and an Apple Developer ID certificate with
   notarization (see Tauri's [signing guides](https://v2.tauri.app/distribute/sign/)).
2. Decide which of the desktop app's experimental subsystems (see the README's *Experimental / roadmap* section) are
   ready to be part of a release.
3. Then tag `desktop-v<version>` to build and publish the installers.

---

## Checklist

| Step | Status |
| :--- | :--- |
| Tests, typecheck, air-gap scan pass in CI | Checked on every push |
| Extension used day to day on real projects | Pending |
| Marketplace publisher and Open VSX namespace `vedara` | Pending registration |
| Domain (`getvedara.dev` / `getvedara.com`) | Pending registration |
| Trademark search for "Vedara" | Pending |
| Repository made public with clean history | Pending (see the public-release plan) |
| Screenshots or GIF in the extension README | Pending |
| Desktop installers | Not planned for the first release |
