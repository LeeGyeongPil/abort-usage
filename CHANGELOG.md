# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.1] - 2026-11-27

### Fixed
- CI: type check resolves the `abort-usage` import through `tsconfig` paths; workflow actions bumped to v6.
- Tests verify callback order for all four endings (finish, abort, error, multi-step).
- README: callback-order test note matches the tests.

## [0.1.0] - 2026-11-27

### Added
- `usageMiddleware()`: AI SDK 7 language model middleware that closes each streamed model call exactly once
  (finish chunk, error chunk, abort signal, stream cancel, or stream end without finish) and reports its token usage.
- `createUsageTracker()`: per-request helper with `wrap(model)`, `steps` and `summary()` (open steps included as estimates).
- Every number is labelled `reported` or `estimated`, with `method`, `confidence` and warning codes.
- `charClassEstimator()` (dependency-free, fitted on a small o200k_base corpus) and `tokenizerEstimator()` for an injected tokenizer.
- `toLanguageModelUsage()` converts a summary or step into the SDK's `LanguageModelUsage`.
- Keyless demo (`npm run demo`, `--lang en|ko`, `--json`) and calibration script (`npm run calibrate`).
- Runnable examples: `examples/quickstart.ts`, `examples/billing.ts`, `examples/with-gpt-tokenizer.ts`.
