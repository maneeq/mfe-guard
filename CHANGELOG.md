# Changelog

## 0.1.1

- Manifests and config files saved with a UTF-8 byte-order mark (Windows Notepad) now load.
- Invalid JSON errors show the line and column, and say so when a URL returned HTML.
- Patch-only `version-drift` is folded into one summary line; `--verbose` lists each package.
- Minor `version-drift` now notes which participant will run on the newer version at runtime.

## 0.1.0

- First release: manifest and project modes; rules `singleton-unsatisfied`, `major-mismatch`,
  `duplicate-name`, `exact-pin`, `not-singleton`, `version-drift`; text and JSON output.
