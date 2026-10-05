# EcoKart

EcoKart is a multi-vendor marketplace for India with a storefront for buyers, a portal for sellers, and a console for administrators.
The architecture, data model, and main flows are described in [docs/system-design.md](docs/system-design.md).
The backend is built step by step following [docs/backend-spec.md](docs/backend-spec.md).

## What is in this repository

| Path | What it is |
| --- | --- |
| `apps/web` | Next.js app (App Router, React, TypeScript, Tailwind CSS) for the storefront, seller portal, and admin console |
| `apps/worker` | Background worker (Node.js, TypeScript, pg-boss) for slow work such as AI calls, emails, and imports |
| `packages/core` | Business logic shared by the web app and the worker |
| `compose.yaml` | Local PostgreSQL 16 with pgvector, matching production |

## Requirements

- [pnpm 12](https://pnpm.io/installation).
  If you already have pnpm 11.10 or newer, run `pnpm self-update`.
  Otherwise install it with `curl -fsSL https://get.pnpm.io/install.sh | sh -`.
- [Docker](https://www.docker.com/), for the local database.

You do not need to install Node.js yourself.
pnpm reads `devEngines.runtime` in `package.json` and downloads the right Node.js version (24) for every script.

## Getting started

```bash
pnpm install
pnpm db:up
cp packages/core/.env.example packages/core/.env
cp apps/web/.env.example apps/web/.env
cp apps/worker/.env.example apps/worker/.env
pnpm db:migrate
pnpm db:seed
pnpm dev
```

`pnpm db:migrate` creates every table, sets the passwords of the two database users the programs log in as (`ecokart_web` for the web app and `ecokart_worker` for the worker), and installs the job queue tables and queues.
Run it again whenever you pull new migrations; it does nothing when the database is already up to date.
`pnpm db:seed` saves example values for the settings only the client can decide, such as the commission rate, creates three approved example sellers whose owners sign in as `seller1@ecokart.test`, `seller2@ecokart.test`, and `seller3@ecokart.test`, and adds an example category tree and a few brands.
The example GST rates are not tax advice; the real ones come from the client's chartered accountant.
It never overwrites what already exists.

`pnpm db:up` also starts Mailpit, which catches every email and SMS the worker sends locally.
Read them at http://localhost:8025, for example the code when you sign in.
To make yourself an administrator, run `pnpm admin:create --email you@example.com --name "Your Name"` and sign in with that email.

Then open http://localhost:3000.
The health check at http://localhost:3000/api/health shows whether the web app can reach the database.

The local database listens on port 5434, so it does not clash with a PostgreSQL server already running on 5432.
To use another port, set `POSTGRES_PORT` before `pnpm db:up`, change the database URLs in all three `.env` files to match, and set `TEST_DATABASE_SERVER_URL` (for example `postgres://ecokart:ecokart@localhost:5435/postgres`) when running tests.

## Commands

Run these from the repository root.

| Command | What it does |
| --- | --- |
| `pnpm dev` | Starts the web app and the worker, reloading on every change |
| `pnpm db:up` | Starts the local database and Mailpit and waits until they are ready |
| `pnpm db:down` | Stops the local database and Mailpit (the data is kept) |
| `pnpm db:migrate` | Applies new migrations, sets the database user passwords, and installs or upgrades the job queue tables |
| `pnpm db:seed` | Saves example data for local development; refuses to run in production |
| `pnpm db:generate` | Writes a new SQL migration from changes to the Drizzle schema in `packages/core/src/db/schema` |
| `pnpm auth:schema` | Regenerates the Better Auth tables' schema after its configuration changes |
| `pnpm admin:create` | Creates an administrator account, or makes an existing account one |
| `pnpm check` | Runs everything CI runs: format check, lint, typecheck, test, build |
| `pnpm typecheck` | Type-checks every package |
| `pnpm lint` | Lints with Oxlint, including type-aware rules |
| `pnpm test` | Runs every package's tests against fresh `ecokart_test_*` databases (needs `pnpm db:up`) |
| `pnpm build` | Builds the web app for production |
| `pnpm format` | Formats code and config files with Prettier (Markdown is formatted by hand) |

To run a command in one package, use a filter, for example `pnpm --filter @ecokart/worker dev`.

## Conventions

- Every dependency version lives once in the `catalog` in `pnpm-workspace.yaml`, and each `package.json` refers to it as `catalog:`.
  `pnpm --filter <package> add <name>` does this for you.
- pnpm only installs versions that were published at least a day ago, which protects against compromised releases.
  Packages that need to run install scripts must be approved under `allowBuilds` in `pnpm-workspace.yaml`.
- The worker and `packages/core` run as TypeScript directly on Node.js.
  Use only type-level TypeScript syntax (no `enum`, `namespace`, or constructor parameter properties) and import local files with their `.ts` extension.
- CI runs `pnpm check` against PostgreSQL 16 on every push to `main` and on every pull request.
