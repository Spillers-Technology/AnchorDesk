# Contributing to AnchorDesk

Thanks for spending your time on AnchorDesk. Bug reports, documentation fixes,
integration ideas, and pull requests are all welcome.

## Before you build

- Use Node.js 22, matching the GitHub Actions baseline.
- Search the existing issues first.
- Small, focused fixes can go straight to a pull request.
- For a new integration or a change to ticket, auth, or audit behavior, open an
  issue first so we can agree on the boundary and failure modes.
- Never include customer data, credentials, tokens, or production screenshots.

## Local checks

AnchorDesk has two TypeScript applications. From a fresh clone, install and
check both:

```bash
cd backend
npm ci
npx prisma validate
npx prisma generate
npm test
npm run build

cd ../web-client
npm ci
npm test
npm run lint
npm run build
```

The root `docker compose up --build` path is the best end-to-end smoke test.
See the README quickstart for the required `.env` values.
Schema changes should also be exercised with `npx prisma db push` against a
fresh or disposable PostgreSQL database before release.

## A useful pull request

Keep it narrow, explain the operator problem it solves, list the checks you
ran, and include before/after screenshots for UI work. New behavior should add
or update tests. If a change affects deployment or configuration, update the
README or `docs/` in the same pull request.

**Mobile is a hard requirement.** UI screenshots must include at least one
phone-width capture (≤400px). Run `node docs/scripts/capture-mobile-media.mjs`
against your dev server to generate the device matrix, and add any new view to
that script so it stays covered — see [docs/mobile.md](docs/mobile.md) for the
device classes and touch rules.

By contributing, you agree that your contribution is licensed under the MIT
license in this repository.
