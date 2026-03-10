# ViewerLeaf

ViewerLeaf is a macOS-first desktop workbench for academic writing with LaTeX.

## Current state

- React + TypeScript desktop shell with:
  - project tree
  - CodeMirror source editor
  - pdf.js-backed PDF preview
  - compile log dock
  - agent profile dock
  - figure workspace with manual banana generation flow
- Tauri/Rust command surface for:
  - project open/save
  - compile
  - SyncTeX forward/reverse search
  - provider and skill metadata
  - figure and asset registration
  - Node sidecar agent calls
- Node sidecar skeleton for:
  - academic agent runs
  - figure brief refinement
  - banana generation payloads

## Prerequisites

- Node.js 20+
- Rust toolchain with Cargo
- `latexmk`
- `synctex`

## Local development

```bash
npm install
npm run dev
```

If you have the Rust toolchain available, add the Tauri CLI workflow on top of the Vite frontend.

## Notes

- The browser runtime uses a mock backend so the UI can be exercised without Tauri.
- The Tauri layer expects a local LaTeX environment and a Node runtime for the sidecar.
