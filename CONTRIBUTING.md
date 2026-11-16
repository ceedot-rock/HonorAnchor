# Contributing to HonorAnchor

## Flow

1. Open an issue or pick an existing one.
2. Branch from the default branch (`main`): `fix/short-name`.
3. Keep diffs small and focused; one concern per pull request.
4. Open a pull request against `main` using the template. CI must pass.
5. A maintainer merges. Never push directly to `main`.

## Checks

Run `npx tsx --test tests/*.test.ts` and `npx tsc --noEmit`. CI must pass.

## Secrets

Never commit API keys, tokens, or credentials. If you leak one, rotate it
immediately and say so in the pull request.

## License

This repo has no LICENSE file yet, so contributions are all-rights-reserved by default. Do not copy code in from other licensed projects until the owner adds a license (recommendation: match the lab standard dual AGPL-3.0-or-later / Commercial license; owner decides).
