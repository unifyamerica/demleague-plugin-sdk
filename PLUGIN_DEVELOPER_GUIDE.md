# DemLeagueOS Plugin Developer Guide

How to build, test, publish and get approval for a third-party plugin (module) for DemLeagueOS.

This guide accompanies the example plugin `@unifyamerica/demleague-plugin-acme-notes`
([unifyamerica/demleague-plugin-acme-notes](https://github.com/unifyamerica/demleague-plugin-acme-notes)), which
is also the template for new plugins. The SDK lives in
[unifyamerica/demleague-plugin-sdk](https://github.com/unifyamerica/demleague-plugin-sdk); both repositories are
public. It is written for software engineers. Readers who plan or review plugin work, such as technical
project managers, can start with [At a glance](#1-at-a-glance) and
[How a plugin gets into production](#3-how-a-plugin-gets-into-production), then use
[the checklist](#17-submission-checklist) to follow progress.

> **Contract version:** `@unifyamerica/demleague-plugin-sdk` 0.1.x, `SDK_API_VERSION = 1`, NestJS 12, Node 24, Vue 3.5,
> PrimeVue 4.

---

## Contents

1. [At a glance](#1-at-a-glance)
2. [Key concepts](#2-key-concepts)
3. [How a plugin gets into production](#3-how-a-plugin-gets-into-production)
4. [Quick start](#4-quick-start)
5. [Project setup](#5-project-setup)
6. [The manifest](#6-the-manifest)
7. [Permissions](#7-permissions)
8. [Endpoints and controllers](#8-endpoints-and-controllers)
9. [Platform services (proxies)](#9-platform-services-proxies)
10. [Storing data](#10-storing-data)
11. [Events](#11-events)
12. [Building the UI](#12-building-the-ui)
13. [Resource limits](#13-resource-limits)
14. [Errors](#14-errors)
15. [Testing](#15-testing)
16. [Publishing and installation](#16-publishing-and-installation)
17. [Submission checklist](#17-submission-checklist)
18. [Troubleshooting](#18-troubleshooting)
19. [Known limitations](#19-known-limitations)
20. [Versioning and compatibility](#20-versioning-and-compatibility)
21. [Glossary](#21-glossary)

---

## 1. At a glance

A **plugin** adds features to DemLeagueOS, such as new endpoints, data storage of its own, reactions to
platform events and pages in the web app (SPA), without changing the core codebase. Plugins are built and
released as npm packages on GitHub Packages, each from its own repository in the `unifyamerica` GitHub
organization, then installed into the platform through a pull request the core team opens and reviews.

| Question | Answer |
| --- | --- |
| What is a plugin technically? | A NestJS module, declared with `@PluginModule()` instead of `@Module()`, plus an optional Vue UI in the same package (`./ui` entry). |
| What can it import from the platform? | Only `@unifyamerica/demleague-plugin-sdk`. Also `@nestjs/common`, `class-validator`, `class-transformer` and its own files. The UI: `@unifyamerica/demleague-plugin-sdk/vue`, `vue`, `primevue`, `primeicons`. |
| Where are its endpoints? | Under `/plugins/<vendor>/<module>`, e.g. `/plugins/acme/notes/notes`. |
| Where are its pages? | Under `/apps/<vendor>/<module>` in the SPA, e.g. `/apps/acme/notes`. |
| Where does its data live? | In its own MongoDB collections, which it can't share with other plugins and which are separate from core data. Records are isolated per organization by the host. |
| Can it read users and organizations? | Yes, through read-only proxies, if the core team approves the permission. On a user's request, only what that user may see. |
| Who decides what it may do? | The vendor **declares** needs in the manifest. The core team **approves** them in the namespace registry. Both have to agree, or the API won't start. |
| What stops it from using too much? | Request, database, storage and time limits, enforced by the host. |
| What does the vendor have to deliver? | A module repository with unit tests, released by the org's release workflow from a version tag, plus the approvals it asks for. The core team opens the PR that installs it. |

### What a plugin can do

- Expose REST endpoints that are authenticated (the default) or, once approved, public
- Store and query its own documents
- Read users and organizations, and update a user's profile name and timezone
- Emit its own events and react to platform events and other plugins' events
- Declare its own abilities (e.g. `read Note`), granted to organization roles once approved,
  and restrict endpoints and pages with them or with platform abilities
- Know which organization (tenant) a request acts in
- Ship a Vue UI: pages, entries in approved app menus, its own stores and translations

### What a plugin cannot do (today)

- Import core API code, reach the database directly, or inject core services
- Import core SPA code, `vue-router`, Pinia directly, or an HTTP client in its UI
- Read or write other plugins' data, or core collections
- Read configuration from environment variables (there is no configuration API yet)
- Register global guards, interceptors, filters or pipes, or import other Nest modules
- Declare database indexes
- Rely on events being delivered: they are in-memory and can be lost on a crash
- Be installed or updated at runtime: the UI is bundled into the SPA at build time

If a feature needs something on the second list, ask the core team for a new SDK capability. Don't work
around the contract: the review will reject it.

---

## 2. Key concepts

**Namespace.** The plugin's unique identity, `<vendor>.<module>`, for example `acme.notes`. It determines
the URL (`/plugins/acme/notes`), the collection names (`plugin_acme_notes_<name>`), and the prefix of the
plugin's events (`acme.notes.*`). The core team registers it to your package. Vendors `core`, `plugins`,
`auth`, `api` and `admin` are reserved.

**Manifest.** A plain object that declares everything the plugin needs: permissions, endpoints, collections,
events, limits, abilities and UI slots. It is the plugin's side of the contract and is checked when the code
loads and again when the API starts. Both the server code and the UI import it.

**Namespace registry.** `api/namespace-registry.json` in the DemLeagueOS repo, owned by the core team
through CODEOWNERS. It records which package owns each namespace, the approved permissions, public
endpoints, ability grants and UI slots, limit ceilings, the trust tier (`first-party`, `verified` or
`community`) and an `enabled` kill switch.

**Abilities.** The plugin's own CASL subjects (`Note`) and which organization roles get which actions on them
(`member: ['read']`). The host turns approved grants into each user's rules, so `@RequireAbility()` on the API
and page/menu checks in the SPA test the same thing. Organization role grants apply only in that organization.

**UI slots.** Places in the SPA's own chrome where a plugin may add entries: `main-menu` and `profile-menu`.
Pages need no slot.

**Host.** The DemLeagueOS API. It loads plugins, mounts their routes, runs authentication and quotas, and
provides the real implementations of the SDK's services.

**Proxies.** Abstract classes from the SDK (`UsersProxy`, `DataProxy`, ...) that a plugin injects. The host
provides implementations that check permissions, meter usage and validate input on every call.

**Actor.** The authenticated user making the current request (`PluginActor`). It is `null` on public
endpoints and in event handlers.

**Tenant.** The organization a request acts in, chosen by the client with the `X-Tenant` header (the
organization's slug). Every authenticated request to your endpoints has one (the host answers `400
TENANT_REQUIRED` without it); only approved public endpoints can be called without one. The host has already
checked that the actor is an active member of it. There are no platform-wide roles: users only ever act in
an organization they belong to. In the SPA it's the
organization picked in the header switcher, which the plugin UI's API calls send automatically.

**Turned on per organization.** An approved, installed module is **off** in every organization until that
organization's org admins turn it on, on the Modules page. If it declares an `onEnabled` lifecycle hook, it's
only on once that hook has run there ("Setting up…" until then). Turning it off takes effect right away,
then runs its `onDisabled` hook (see [Lifecycle hooks](#lifecycle-hooks-turned-on-and-off)). While it's not
on in an organization:

- The host answers your endpoints with `403` (JSON:API error `code: "MODULE_DISABLED"`) for requests in that
  tenant, before authentication and quotas, so your request handlers never run.
- Your event handlers don't get that organization's events. Each event names the organization it happened in
  (`event.organizationId`: a core event's `payload.organizationId`, or the tenant of the request a plugin
  emitted it from), and the host checks the module is on there when delivering it.
- The SPA hides your pages and menus in that organization.

Requests without a tenant (only possible on a public endpoint called without `X-Tenant`) and events about no organization
(`organizationId: null`, e.g. `core.user.created`) don't belong to any organization, so they still reach you.

---

## 3. How a plugin gets into production

```
 Module repo                   GitHub Packages                                           DemLeagueOS repo
 (unifyamerica org)            (npm.pkg.github.com)                                      (PR opened by the core team)
 ──────────────────            ────────────────────                                      ────────────────────────────
 write code + tests  ──tag──▶  @unifyamerica/demleague-plugin-<vendor>-<module>  ──PR──▶ api/package.json                (exact version)
 manifest.ts          vX.Y.Z   built and attested by the org's release workflow          api/src/plugins.config.ts       (package → module)
 src/ui (optional)                                                                       api/namespace-registry.json     (approval, core team)
                                                                                         frontend/package.json           (exact version, if UI)
                                                                                         frontend/src/plugins.config.ts  (./ui entry, if UI)
```

**Where a module lives.** The core team creates one repository per module in the `unifyamerica` GitHub
organization, named like its package: `unifyamerica/demleague-plugin-<vendor>-<module>`. The vendor is an
**outside collaborator on that repository only**, never an organization member, so they see nothing else in
the organization, DemLeagueOS included. Pushing a `v<version>` tag runs the org's release workflow, which
checks, builds, attests and publishes the package to GitHub Packages; nothing else can publish a package CI
will accept. The core team then opens the install PR on DemLeagueOS (see
[§16](#16-publishing-and-installation)).

> **Module repositories must be public for now.** The `unifyamerica` organization is on GitHub's Team plan,
> where artifact attestations only work in public repositories (private ones need Enterprise Cloud). A
> private module repo's release can't be attested, so it can't be released or installed. The core team is
> choosing between Sigstore keyless signing with cosign (works on Team, but a private repo's name, workflow
> and commit are recorded in Sigstore's public transparency log), upgrading to Enterprise Cloud, and requiring
> public module repos. Until then, plan on your module's source being public.

There are **two separate gates**, and a plugin loads only when both agree:

1. **The manifest (vendor-authored)** says what the plugin needs.
2. **The registry entry (core-team-authored)** says what it is allowed.

When the API starts, it refuses to boot unless every installed plugin:

- has a valid manifest and was built against the host's copy of the SDK (so the SDK must be a peer dependency)
- uses a namespace that is registered to its package, and is `enabled`
- declares only approved permissions, public endpoints, ability grants and UI slots
- defines exactly the routes its manifest declares, no more and no fewer
- uses `@RequireAbility()` only on platform subjects or subjects declared in `manifest.abilities`
- injects only SDK services and its own providers

A plugin that asks for more than its approved **limits** still loads. Its limits are capped, and the API logs
a warning.

The same boot gate runs in CI on every PR, so a mismatch fails the install PR instead of a deploy. See
[What CI checks on your PR](#what-ci-checks-on-your-pr).

The SPA bundles the plugin's UI at build time. A plugin's pages only open while the API has the plugin
loaded, and its menu entries only appear in approved slots.

**Updating a plugin** is a new release (another version tag in the module repo), then another core team PR
that changes the exact version in `api/package.json` (and `frontend/package.json`). Reviewers diff the
manifest. New permissions, public endpoints, grants or slots won't load until the registry approves them.

**The whole cycle, from submission to production:**

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/plugin-contribution-cycle-dark.svg">
  <img src="docs/images/plugin-contribution-cycle.svg" width="900" alt="Swimlane flow chart of the plugin contribution cycle across four lanes: vendor, GitHub (unifyamerica org and Packages), DemLeagueOS repo (core team) and production. The vendor agrees a namespace with the core team, who creates the module repository unifyamerica/demleague-plugin-&lt;vendor&gt;-&lt;module&gt; and adds the vendor as an outside collaborator. The vendor starts from the acme-notes template, passes local checks (lint guardrails, type-check, tests, build) and pushes a v&lt;x.y.z&gt; tag. The org release workflow checks and builds the module in a read-only job, then attests the tarball and publishes it to GitHub Packages in a job that runs no vendor code. The vendor asks the core team to install it and the core team opens the install PR pinning the exact version. The Plugin contract CI check (attested by the org workflow from that tag, lockfile hash, exact pins and both config files, import guardrails on the shipped dist/, the boot gate and the SPA's UI tests, plus the full CI suite) and the core team's review can each send it back to the vendor. Once merged, the approvals land in namespace-registry.json and the module ships with the next API and SPA deploy, where the API boot gate requires the manifest and registry to agree. It stays off in every organization until an org admin turns it on in the Modules page and its onEnabled hook has run.">
</picture>

Green outlines are automated checks, orange ones human decisions, and dashed lines the paths back to the
vendor. Also available as a [PNG](docs/images/plugin-contribution-cycle.png).

---

## 4. Quick start

```bash
# 1. Clone your module repo. The core team creates it in the unifyamerica org, named like the package,
#    seeds it with the template (github.com/unifyamerica/demleague-plugin-acme-notes) and adds you as an
#    outside collaborator.
git clone https://github.com/unifyamerica/demleague-plugin-myvendor-tasks.git && cd demleague-plugin-myvendor-tasks

# 2. Rename: package.json "name"       → @unifyamerica/demleague-plugin-myvendor-tasks (@unifyamerica/<repo name>)
#            package.json "repository" → { "type": "git", "url": "git+https://github.com/unifyamerica/demleague-plugin-myvendor-tasks.git" }
#                                        (no "directory": GitHub links the package to this repo through it)
#            src/manifest.ts namespace → 'myvendor.tasks', reset version to 0.1.0 in both places
#    Keep "publishConfig": { "registry": "https://npm.pkg.github.com" } and .npmrc as they are.

# 3. Read access to GitHub Packages, once, in your user ~/.npmrc (never in the repo): a classic personal
#    access token with read:packages. The SDK package is public, so that token is all you need.
echo "//npm.pkg.github.com/:_authToken=<token>" >> ~/.npmrc

# 4. Install, test, lint
npm install
npm test            # Jest (server) + Vitest (UI)
npm run lint
npm run type-check
npm run build
```

Then add the release workflow to the repo as `.github/workflows/release.yml`, so tags publish the package
(see [§16](#16-publishing-and-installation)):

```yaml
name: Release
on:
  push:
    tags: ['v*']
permissions:
  contents: read
  packages: write
  id-token: write
  attestations: write
jobs:
  release:
    uses: unifyamerica/demleague-plugin-workflows/.github/workflows/plugin-release.yml@main
```

No UI? Delete `src/ui`, `tsconfig.ui.json`, `vite.config.mts` and `vitest.config.mts`, the `./ui` export and
the UI steps of the `build`, `test` and `type-check` scripts.

A minimal but complete plugin:

```ts
// src/manifest.ts
import { type PluginManifest, SDK_API_VERSION } from '@unifyamerica/demleague-plugin-sdk/manifest';

export const TASKS_MANIFEST: PluginManifest = {
  sdkApiVersion: SDK_API_VERSION,
  namespace: 'myvendor.tasks',
  version: '0.1.0',                       // keep equal to package.json
  displayName: 'Tasks',
  description: 'Personal task lists',
  permissions: ['data:read', 'data:write'],
  endpoints: [
    { method: 'GET', path: '/tasks', summary: 'List my tasks' },
    { method: 'POST', path: '/tasks', summary: 'Create a task' },
  ],
  collections: ['tasks'],                 // stored as plugin_myvendor_tasks_tasks
  events: { emits: ['myvendor.tasks.task-created'] },
  abilities: {                            // members of an organization keep tasks in it
    Task: { organization: { member: ['read', 'create'] } },
  },
};
```

```ts
// src/tasks/tasks.controller.ts
import { CurrentActor, DataProxy, EventBusProxy, PluginActor, RequireAbility } from '@unifyamerica/demleague-plugin-sdk';
import { Body, Controller, Get, Post } from '@nestjs/common';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

class CreateTaskDto {
  @IsString() @IsNotEmpty() @MaxLength(200)
  title!: string;
}

interface Task { ownerId: string; title: string; done: boolean }

@Controller('tasks')                       // → /plugins/myvendor/tasks/tasks
export class TasksController {
  constructor(private readonly data: DataProxy, private readonly events: EventBusProxy) {}

  private get tasks() {
    return this.data.collection<Task>('tasks');
  }

  @Get()
  @RequireAbility('read', 'Task')          // checked in the request's organization (X-Tenant)
  list(@CurrentActor() actor: PluginActor) {
    // the host only returns records of the request's organization
    return this.tasks.find({ filter: { ownerId: actor.id }, sort: { createdAt: -1 } });
  }

  @Post()
  @RequireAbility('create', 'Task')
  async create(@CurrentActor() actor: PluginActor, @Body() dto: CreateTaskDto) {
    const task = await this.tasks.insert({ ownerId: actor.id, title: dto.title, done: false });
    this.events.emit('myvendor.tasks.task-created', { taskId: task.id, ownerId: actor.id });
    return task;
  }
}
```

```ts
// src/tasks.plugin.ts
import { PluginModule } from '@unifyamerica/demleague-plugin-sdk';
import { TASKS_MANIFEST } from './manifest';
import { TasksController } from './tasks/tasks.controller';

@PluginModule({ manifest: TASKS_MANIFEST, controllers: [TasksController], providers: [] })
export class MyvendorTasksPlugin {}
```

```ts
// src/index.ts: the package's public entry point
export { MyvendorTasksPlugin } from './tasks.plugin';
export { TASKS_MANIFEST } from './manifest';
```

In a real plugin, put the logic in a service as the example plugin does. Controllers stay thin and services
are easier to test. To add pages to the SPA, see [§12](#12-building-the-ui).

---

## 5. Project setup

### Layout (from the example plugin)

```
src/
  index.ts                     exports the plugin module and manifest
  manifest.ts                  the manifest
  manifest.spec.ts             manifest is valid + version matches package.json
  <name>.plugin.ts             @PluginModule()
  <feature>/
    <feature>.controller.ts
    <feature>.service.ts
    <feature>.service.spec.ts
    <feature>.interface.ts     stored document shape, event names
    dto/*.dto.ts               class-validator DTOs
  listeners/
    <event>.listener.ts        subscribes in onModuleInit
    <event>.listener.spec.ts
  ui/                          the SPA UI (optional, see §12), browser code only
    index.ts                   default exports createPluginUi(manifest).define({...})
    index.spec.ts              the UI definition is valid
    plugin.ts                  createPluginUi(manifest) and its composables
    types.ts                   the API's response shapes
    pages/*.vue                one component per route, plus *.spec.ts
    stores/*.ts                Pinia setup stores (defineStore from plugin.ts)
    i18n/en.ts                 the UI's messages
tsconfig.ui.json               type-checks src/ui, emits its declarations
vite.config.mts                builds src/ui into dist/ui
vitest.config.mts              runs src/ui/**/*.spec.ts
```

### `package.json` essentials

```jsonc
{
  "name": "@unifyamerica/demleague-plugin-<vendor>-<module>",
  "version": "0.1.0",                       // must equal manifest.version
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
    "./ui": { "types": "./dist/ui-types/ui/index.d.ts", "default": "./dist/ui/index.js" }, // if UI
    "./package.json": "./package.json"
  },
  "files": ["dist", "!dist/**/*.spec.*"],
  "repository": {                          // GitHub links the package to its module repo through it
    "type": "git",
    "url": "git+https://github.com/unifyamerica/demleague-plugin-<vendor>-<module>.git"
  },
  "publishConfig": { "registry": "https://npm.pkg.github.com" },  // GitHub Packages
  "scripts": {
    "build": "node -e \"require('fs').rmSync('dist', { recursive: true, force: true })\" && tsc -p tsconfig.build.json && vite build && vue-tsc -p tsconfig.ui.json",
    "test": "NODE_OPTIONS='--experimental-vm-modules --disable-warning=ExperimentalWarning' jest && vitest run",
    "type-check": "tsc --noEmit && vue-tsc -p tsconfig.ui.json --noEmit",
    "lint": "eslint \"src/**/*.{ts,vue}\""
  },
  "peerDependencies": {                     // NEVER regular dependencies
    "@unifyamerica/demleague-plugin-sdk": "^0.1.0",
    "@nestjs/common": "^12.0.0",
    "class-transformer": "^0.5.1",
    "class-validator": "^0.15.0",
    "reflect-metadata": "^0.2.0",
    "primevue": "^4.5.0",                   // if UI (optional peer)
    "vue": "^3.5.0"                         // if UI (optional peer)
  },
  "peerDependenciesMeta": { "primevue": { "optional": true }, "vue": { "optional": true } },
  "devDependencies": { /* the same packages, plus @nestjs/core, @nestjs/testing, jest, ts-jest, typescript;
                          for a UI: pinia, vite, @vitejs/plugin-vue, vue-tsc, @vue/tsconfig, vitest, jsdom,
                          @vue/test-utils, eslint-plugin-vue */ },
  "jest": { /* ... */ "testPathIgnorePatterns": ["/node_modules/", "/ui/"] }  // UI specs run in Vitest
}
```

The release workflow refuses to publish unless `name` is `@unifyamerica/<repo name>`, the tag is
`v<version>`, `publishConfig.registry` is GitHub Packages, the SDK is a peer dependency and the `lint`,
`type-check`, `test` and `build` scripts exist. The template's `.npmrc` maps the `@unifyamerica` scope to
GitHub Packages (`@unifyamerica:registry=https://npm.pkg.github.com`); the token goes in your user
`~/.npmrc`, never in the repo.

**Why peer dependencies matter.** The host must share one copy of each of these packages with the plugin:

- **SDK:** a second copy means its abstract classes are different DI tokens, so nothing injects. The host
  detects the duplicate and refuses to start.
- **`class-validator`:** a second copy means the global `ValidationPipe` doesn't see your decorators, so
  validation is **silently skipped**. This is the most dangerous one.
- **Vue, Pinia, PrimeVue, the SDK in the UI:** the SPA provides one copy. The Vite build keeps `vue`, `pinia`,
  `primevue`, `primeicons` and `@unifyamerica/demleague-plugin-sdk` external, so none of them end up in `dist/ui`.

### TypeScript

Use the template's `tsconfig.json`: `commonjs`, `ES2024`, `strict`, `experimentalDecorators` and
`emitDecoratorMetadata`. Decorator metadata is required for constructor injection. It excludes `src/ui`.

The UI has its own `tsconfig.ui.json` (extends `@vue/tsconfig/tsconfig.dom.json`), which covers `src/ui` and
`src/manifest.ts` and emits declarations into `dist/ui-types`. Vite builds the code. Since the manifest is
compiled for both, import it from the NestJS-free `@unifyamerica/demleague-plugin-sdk/manifest`.

### Lint guardrails (keep them)

The template's `eslint.config.mjs` enforces, for non-test files:

- server code: imports only from `@unifyamerica/demleague-plugin-sdk` (and `/manifest`), `@nestjs/common`,
  `class-validator`, `class-transformer` and relative paths
- UI code (`src/ui`): imports only from `@unifyamerica/demleague-plugin-sdk/vue`, `vue`, `primevue/*`, `primeicons/*`, its
  own `src/ui` files and `../manifest`. Not Pinia, `vue-router`, `axios` or the plugin's server code.
- no `process.env`
- no `eval`, `Function` or `require`

Spec files are exempt (UI tests import `pinia`, `@vue/test-utils` and `vitest`). These rules are also
checked in review. Plugins run inside the API process, and their UI inside the SPA, so these rules are part
of the safety model.

---

## 6. The manifest

```ts
interface PluginManifest {
  sdkApiVersion: number;              // always SDK_API_VERSION
  namespace: string;                  // '<vendor>.<module>'
  version: string;                    // semver, equal to package.json
  displayName: string;                // non-empty
  description?: string;
  permissions: PluginPermission[];    // see §7
  endpoints: PluginEndpointDeclaration[]; // use [] for none
  collections?: string[];             // see §10
  events?: { emits?: string[]; subscribes?: string[] }; // see §11
  limits?: PluginResourceLimits;      // see §13
  abilities?: PluginAbilities;        // see §7
  ui?: { slots?: PluginUiSlot[] };    // 'main-menu' | 'profile-menu', see §12
}

// Subject → which organization roles get which actions on it (grants are per organization only)
type PluginAbilities = Record<string, {
  organization?: { member?: PluginAbilityAction[]; org_admin?: PluginAbilityAction[] }; // in that org only
}>;
type PluginAbilityAction = 'manage' | 'create' | 'read' | 'update' | 'delete';

interface PluginEndpointDeclaration {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;                       // relative to /plugins/<vendor>/<module>, starts with '/'
  summary?: string;
  auth?: 'user' | 'public';           // default 'user'
}
```

### Validation rules

`validateManifest()` runs when the `@PluginModule()` class is defined and again at startup. It reports every
problem at once.

| Field | Rule |
| --- | --- |
| `sdkApiVersion` | Must equal the SDK's `SDK_API_VERSION` (currently `1`). |
| `namespace` | `^[a-z][a-z0-9-]{1,30}\.[a-z][a-z0-9-]{1,40}$`. The vendor can't be `core`, `plugins`, `auth`, `api` or `admin`. |
| `version` | Semver (`1.2.3`, `1.2.3-beta.1`, `1.2.3+build`). |
| `displayName` | Required and not blank. |
| `permissions` | An array of known permissions, without duplicates. `users:read:email` requires `users:read`. |
| `endpoints` | An array. Each `path` starts with `/` and its segments are kebab-case or `:params` (`:noteId`). There are no duplicate `METHOD path` pairs. |
| `collections` | snake_case, 1–41 characters, starting with a letter, without duplicates. Required if `data:read` or `data:write` is declared, and not allowed otherwise. |
| `events.emits` | Each event is `<namespace>.<kebab-name>`, e.g. `acme.notes.note-created`. |
| `events.subscribes` | A known core event (`core.*`) or a `<vendor>.<module>.<event>` name. |
| `lifecycle` | Only `onEnabled`, `onDisabled`, `onDataRemoved`, `onUpgraded`, each `true` or `false`. Required for each hook you register (§11). |
| `limits` | Only known limit names, each a positive integer. |
| `abilities` | Subjects are PascalCase (`^[A-Z][A-Za-z0-9]{0,40}$`) and not a platform subject (`all`, `User`, `Organization`, `Plugin`). Only the `organization` scope (there are no system grants), known roles (`member`, `org_admin`), known actions without duplicates. |
| `ui.slots` | Known slots (`main-menu`, `profile-menu`), without duplicates. |

Also enforced by `@PluginModule()`: there is no `imports` option, and providers may not use `APP_GUARD`,
`APP_INTERCEPTOR`, `APP_FILTER` or `APP_PIPE`.

### Best practices

- Keep the manifest in its own file (`src/manifest.ts`), import from `@unifyamerica/demleague-plugin-sdk/manifest`, and
  export it. Reviewers read this file first.
- Add a `summary` to every endpoint. It appears in the plugin listing (`GET /plugins`, the SPA's Modules page).
- Ask for the fewest permissions that work. Each one is reviewed and has to be justified.
- Add `manifest.spec.ts` (copy it from the template) to check validity and the version match.

---

## 7. Permissions

| Permission | Allows | Notes |
| --- | --- | --- |
| `users:read` | `UsersProxy.findById` / `findByIds`: name, membership in the current organization | No email address. |
| `users:read:email` | Also includes `email` in returned users | PII. Requires `users:read`. Reviewed strictly. |
| `users:write` | `UsersProxy.updateProfile`: `firstName`, `lastName`, `timezone` | Nothing else can be changed. |
| `organizations:read` | `OrganizationsProxy.findById` / `findByIds` | |
| `data:read` | `find`, `findById`, `count` on your own collections | Scoped to the request's tenant (§10). |
| `data:write` | `insert`, `update`, `remove` on your own collections | Scoped to the request's tenant (§10). |

**Two layers apply on every call:**

1. **The plugin's permissions.** Without the permission, a call throws `PluginPermissionDeniedError` (403).
2. **The acting user's permissions**, on a user's request. A plugin can never do more on someone's behalf
   than that user could do themselves. Reads silently return only what the user may see. A forbidden
   `updateProfile` throws `PluginActorForbiddenError` (403).

In **event handlers and public endpoints** there's no acting user, so only the plugin's own permissions
apply. Be careful about what such code reads and returns.

### The plugin's own abilities

Declare subjects for what your plugin offers and grant actions on them to organization roles:

```ts
abilities: {
  Note: {
    organization: {
      member: ['read', 'create', 'update', 'delete'],  // org admins are members too: they get these
    },
  },
  Overview: { organization: { org_admin: ['read'] } }, // only the organization's org admins
},
```

- **Organization grants apply per organization.** A user who is `member` of organization A and `org_admin`
  of organization B gets the `member` actions only in A, and the `org_admin` actions only in B. Each grant
  becomes a CASL rule on `<namespace>:<Subject>` with the condition `{ organizationId }`.
- **Org admins are members too.** They also get every `member` grant (`ORGANIZATION_ROLE_INCLUDES`), so grant
  `member` what every member may do and `org_admin` only what org admins get on top.
- **There are no system grants and no platform admins.** Nobody holds `manage all`, so a subject with no
  grants (`{}`) is usable by nobody in the organization API. Cross-organization staff tooling belongs to the
  planned admin app, not to plugins.
- `manage` covers every action.
- Each grant must be approved in the registry (`approvedAbilityGrants`, same shape; an approved `manage`
  covers any action). Grants decide who sees the plugin's data, so they're a core-team decision.
- Roles are exported as `OrganizationRoles`. New organization roles arrive in SDK minor releases. The host
  rejects unknown roles.

### Restricting an endpoint

```ts
import { RequireAbility } from '@unifyamerica/demleague-plugin-sdk';

@Get()
@RequireAbility('read', 'Note')              // one of the plugin's own subjects
list(/* ... */) {}

@Patch('settings')
@RequireAbility('update', 'Organization')   // a platform subject, e.g. org admins
updateSettings(/* ... */) {}
```

- Actions: `manage`, `create`, `read`, `update`, `delete`. Subjects: the platform's `User` and
  `Organization`, or one declared in `manifest.abilities`. Any other subject stops the API from starting.
- **Own subjects are checked in the request's tenant** (`X-Tenant`): a `member` grant only lets members of
  that organization through. Authenticated requests always have a tenant (400 without one), and the user's
  ability only holds their membership in it.
- **Platform subjects are a type-level check**, against the user's ability in the request's tenant (“can this
  user update the current organization?”, since that's the only one it holds). For details, use
  `PluginContext.tenant()` and the actor's `memberships` (their membership in it).
- It can go on a handler or on a controller class.
- On a public endpoint it always fails with 401, since there's no user.

Platform roles for reference (there are no system-wide roles): organization `org_admin` (updates its
organization, manages its members and settings, reads the installed plugins), active members (read their
organization and its members), and everyone (reads and updates their own profile).

---

## 8. Endpoints and controllers

### Routing

The host mounts all of a plugin's controllers under `/plugins/<vendor>/<module>`. The **controller path plus
the handler path** must equal a declared endpoint's `path`, and the method must match too:

| Controller | Handler | Full URL | Declared `path` |
| --- | --- | --- | --- |
| `@Controller('notes')` | `@Get()` | `GET /plugins/acme/notes/notes` | `/notes` |
| `@Controller('notes')` | `@Get(':id')` | `GET /plugins/acme/notes/notes/:id` | `/notes/:id` |
| `@Controller()` | `@Get('health')` | `GET /plugins/acme/notes/health` | `/health` |

Every route must be declared, and every declared endpoint must exist. Otherwise the API refuses to start.

### Authentication

- `auth: 'user'` (default): a valid bearer token and an `X-Tenant` the user is an active member of are
  required (`400 TENANT_REQUIRED` without one). `@CurrentActor()` returns a `PluginActor`.
- `auth: 'public'`: no token, and the tenant is optional. `@CurrentActor()` returns `null`. Each public endpoint must be approved in the
  registry as `"METHOD /path"`, such as `"GET /health"`. Expect extra scrutiny: public endpoints shouldn't
  expose user data.

### Request pipeline (per request)

```
declared endpoint? → tenant (unless public: 400) → module on in the tenant (403) → authenticate (unless public)
  → per-user quota → plugin quota → @RequireAbility() → ValidationPipe → your handler → timeout (requestTimeoutMs → 503)
```

### Input validation

The host runs a global `ValidationPipe({ transform: true, whitelist: true })`:

- Use `class-validator` DTO classes for `@Body()` and `@Query()`. Fields without decorators are **stripped**.
- Query strings arrive as strings. Use `@Type(() => Number)` from `class-transformer` to convert them, and
  `@IsBooleanString()` for flags (see `ListNotesQueryDto`).
- Always set `@MaxLength` and `@Max` bounds. They protect your storage quota.

### Responses

- Return plain objects or arrays. Nest serializes them as JSON. Records from `DataProxy` are already plain.
- Use `@HttpCode(204)` for deletes that return nothing.
- Throw `@nestjs/common` HTTP exceptions (`NotFoundException`, `BadRequestException`, ...) for your own
  errors. SDK errors can be left to propagate (see §14).
- To keep ids from being probed, report another user's record as **404, not 403**, as `NotesService.findOwn`
  does.

### Tenancy

```ts
constructor(private readonly context: PluginContext) {}

const org = this.context.tenant();   // PluginOrganization | null: the X-Tenant organization (or a handler's event organization)
if (!org) throw new BadRequestException('X-Tenant header is required');
```

`tenant()` is the **current organization**, and your code can only ever reach that organization. That holds
on a user's request, on a public endpoint and in an event handler (where it's the event's organization).
The host confines your data (see [§10](#10-storing-data)), the users you can find (its active members, see
[§9](#9-platform-services-proxies)) and the organizations you can find (only that one). There's no
way to pick another organization. `@RequireAbility()` on your own subjects checks the user's roles in it.
Use `tenant()` when you need the organization's details, or to refuse requests without one.

---

## 9. Platform services (proxies)

Inject them by type in a constructor. They're the only platform services a plugin may inject (along with
Nest's `Reflector`).

```ts
abstract class UsersProxy {
  findById(id: string): Promise<PluginUser | null>;
  findByIds(ids: string[]): Promise<PluginUser[]>;              // at most 100 ids
  findMembers(query?: { limit?: number; skip?: number }): Promise<PluginPage<PluginUser>>; // the org's active members, by id; limit ≤ 100
  updateProfile(id: string, changes: PluginUserProfileUpdate): Promise<PluginUser>;
}

abstract class OrganizationsProxy {
  findById(id: string): Promise<PluginOrganization | null>;
  findByIds(ids: string[]): Promise<PluginOrganization[]>;      // at most 100 ids
}

abstract class DataProxy {
  collection<T extends object>(name: string): PluginCollection<T>;  // see §10
}

abstract class EventBusProxy {
  emit(name, payload): void;                                     // see §11
  on(name, handler): void;
}

abstract class ModuleLifecycleProxy {                            // see §11, Lifecycle hooks
  onEnabled(handler: (event: ModuleLifecycleEvent) => void | Promise<void>): void;
  onDisabled(handler: (event: ModuleLifecycleEvent) => void | Promise<void>): void;
  onDataRemoved(handler: (event: ModuleLifecycleEvent) => void | Promise<void>): void;
  onUpgraded(handler: (event: ModuleLifecycleEvent) => void | Promise<void>): void;
}

abstract class PluginContext {
  readonly namespace: string;
  readonly manifest: Readonly<PluginManifest>;
  actor(): PluginActor | null;
  tenant(): PluginOrganization | null;
}

abstract class PluginLogger {                                    // use instead of console
  debug(message: unknown): void;
  info(message: unknown): void;
  warning(message: unknown): void;                               // note: warning, not warn
  error(message: unknown): void;
}
```

### Data shapes (DTOs)

These are always plain copies, never database documents.

```ts
interface PluginUser {
  id: string; firstName: string; lastName: string;
  email?: string;                       // only with users:read:email
  memberships: { organizationId: string; roles: string[] }[];   // only the current organization's
}
interface PluginUserProfileUpdate { firstName?: string; lastName?: string; timezone?: string | null }
interface PluginOrganization { id: string; name: string; slug: string; description: string | null }
interface PluginActor {
  id: string;
  memberships: { organizationId: string; roles: string[] }[];   // only their active one in the current organization (≤ 1)
}
```

`UsersProxy` and `OrganizationsProxy` calls count as database operations (`dbOperationsPerMinute`).
`findByIds` returns only the records found and accessible, so the result may be shorter than the input.

Both are **confined to the current organization** (`tenant()`), whoever acts:

- `UsersProxy` only finds (and `updateProfile` only changes) the organization's active members, and a user's
  `memberships` only lists that organization. Without a current organization, it only finds the acting user,
  or in an event handler the user a core event is about.
- `OrganizationsProxy` only finds the current organization, and nothing without one.
- On a user's request, the user's own rights apply on top.

---

## 10. Storing data

Declare each collection in `manifest.collections` and declare `data:read` and/or `data:write`. A collection
named `tasks` in namespace `myvendor.tasks` is stored as `plugin_myvendor_tasks_tasks`. Using an undeclared
name throws `PluginUndeclaredCollectionError`.

```ts
interface PluginCollection<T extends object> {
  insert(document: T): Promise<PluginRecord<T>>;                  // in the current organization
  findById(id: string): Promise<PluginRecord<T> | null>;          // null if missing, removed, or malformed id
  find(query?: PluginQuery): Promise<PluginPage<PluginRecord<T>>>;
  count(filter?: PluginFilter): Promise<number>;
  update(id: string, changes: Partial<T>): Promise<PluginRecord<T> | null>; // shallow merge, null if missing
  remove(id: string): Promise<boolean>;                            // soft delete, false if missing
}

type PluginRecord<T> = T & {
  id: string; createdAt: Date; updatedAt: Date; createdBy: string | null; organizationId: string | null;
};
interface PluginPage<T> { items: T[]; total: number; limit: number; skip: number }
interface PluginQuery { filter?: PluginFilter; sort?: Record<string, 1 | -1>; limit?: number; skip?: number }
```

### Host-managed fields

`id` (a 24-character hex ObjectId string), `createdAt`, `updatedAt`, `createdBy` (the actor's id, or
`null` from an event handler or public endpoint) and `organizationId` (see below) are set by the host. You
can't write them: they're stripped from inserted documents, and `update()` ignores them. You can filter and
sort on them. Filtering on `id` with a malformed id is a 400.

### Isolation per organization

Every record belongs to one organization (`organizationId`), or to none (`null`). The host stores it in
the **current organization** and only shows that organization's records, whoever acts:

| Code runs... | Current organization: `insert` stores in it, `find`, `findById`, `count`, `update`, `remove` only see it |
| --- | --- |
| On a request (user or public endpoint) with `X-Tenant` | The tenant |
| On a request without `X-Tenant` | None: only records with `organizationId: null` |
| In an event handler | The event's organization (`event.organizationId`), or none for an event without one |

- You can't choose the organization: `organizationId` is host-managed, so a value in your document or
  `update()` changes is ignored.
- Records stored before records had an `organizationId` count as `null`.
- Isolation is per organization, not per user: filter on an owner field (such as `ownerId`) for private data,
  as the example plugin does.

### Document rules

- Plain objects, arrays, strings, numbers, booleans, `null` and `Date` only. No class instances, functions,
  symbols or bigints.
- Keys may not start with `$` or contain `.`. Nesting is at most 10 levels deep.
- Size is the JSON of your own fields, capped by `maxDocumentBytes` (413 when exceeded).
- `update()` is a **shallow top-level merge**. To change one field of a nested object, send the whole object.

### Query language

A deliberately small, safe subset of MongoDB:

| Kind | Allowed |
| --- | --- |
| Comparison | `$eq $ne $in $nin $gt $gte $lt $lte $exists` |
| Logical | `$and $or` (non-empty arrays) |
| Field names | Identifiers, dotted paths allowed in filters (`address.city`) |
| `$in` / `$nin` | At most 100 scalar values |
| Nesting depth | At most 4 levels of `$and`/`$or` |
| `limit` | 1–100, default 25 |
| `skip` | ≥ 0 |
| `sort` | `1` or `-1` per field |

Anything else (`$regex`, `$where`, `$expr`, aggregation, ...) is rejected with `PluginValidationError` (400).

```ts
await notes.find({
  filter: { ownerId: actor.id, $or: [{ pinned: true }, { updatedAt: { $gte: since } }] },
  sort: { pinned: -1, updatedAt: -1 },
  limit: 25,
  skip: (page - 1) * 25,
});
```

### Practical notes

- **No indexes yet.** Keep collections modest, always filter on a selective field (such as `ownerId`), and
  paginate.
- **Deletes are soft.** Removed documents disappear from every read and free your storage quota.
- **No transactions or atomic increments.** Design for last-write-wins, or keep counters derivable with
  `count()`.
- Every operation counts towards `dbOperationsPerMinute`. Avoid N+1 loops: use `findByIds` and `$in`.

---

## 11. Events

### Declaring

```ts
events: {
  emits: ['acme.notes.note-created'],          // must start with your namespace
  subscribes: ['core.user.created', 'other.vendor.thing-happened'],
}
```

### Core events

| Event | Payload |
| --- | --- |
| `core.user.created` | `{ userId }` |
| `core.user.updated` | `{ userId, changedFields: string[] }` |
| `core.organization.created` | `{ organizationId }` |
| `core.organization.updated` | `{ organizationId, changedFields: string[] }` |
| `core.organization.member-added` | `{ organizationId, userId }`: the user became an active member (added, or a removed membership restored) |

Users are created without organizations and join them afterwards, so per-organization setup (like a welcome
note) belongs on `core.organization.member-added`, not `core.user.created`.

Core events carry **ids only**. Fetch the record through a proxy, so your permissions apply.

### Emitting

```ts
this.events.emit('acme.notes.note-created', { noteId: note.id, ownerId });
```

- Synchronous and fire-and-forget. It never fails because of a subscriber.
- The payload must be a plain JSON object (`Record<string, JsonValue>`) of at most 32 KB.
- Emitting an undeclared name throws `PluginUndeclaredEventError`.

### Subscribing

Subscribe in `onModuleInit` of a provider:

```ts
@Injectable()
export class MemberAddedListener implements OnModuleInit {
  constructor(private readonly events: EventBusProxy, private readonly users: UsersProxy,
              private readonly data: DataProxy, private readonly logger: PluginLogger) {}

  onModuleInit(): void {
    this.events.on(CoreEvents.ORGANIZATION_MEMBER_ADDED, async (event) => {
      const { userId } = event.payload;                                 // payload is typed for core events
      // The handler runs in the event's organization: only its members are found, the note is stored in it
      const user = await this.users.findById(userId);
      if (!user) { this.logger.warning(`User ${userId} not found`); return; }
      await this.data.collection('notes').insert({ ownerId: user.id, title: `Welcome, ${user.firstName}!` });
    });
  }
}
```

Handlers receive `PluginEvent { id, name, source, emittedAt, organizationId, payload }`, where `source` is
`core` or the emitting plugin's namespace, and `organizationId` is the organization the event happened in
(a core event's `payload.organizationId`, or the tenant of the request a plugin emitted it from; `null` for
neither). You only receive an organization's events while your module is turned on in it (§2).

- Handlers run **asynchronously, without an acting user, in the event's organization**. `actor()` is `null`
  and `createdBy` is `null` on records you insert. `tenant()` is the event's organization, and data, users and
  organizations are confined to it like on a request (§9 Tenancy). For an event without an organization
  (e.g. `core.user.created`), `tenant()` is `null`. You then only see records without an organization, only
  the user a core event is about (`payload.userId`), and no organization.
- Events you emit from a handler happen in its organization too.
- A payload can't name another organization: emitting one whose `organizationId` field isn't the current
  organization's id throws `PluginValidationError`, so you can't point subscribers at another organization.
- A failing or slow handler (`eventHandlerTimeoutMs`) is logged and counted as an error. It never affects the
  emitter.
- Payloads are frozen. Don't mutate them.
- **Events are in-memory and not durable.** Don't use them for anything that must not be lost, such as
  billing or compliance.
- Make handlers idempotent where you can, so they stay correct if a durable transport with retries replaces
  the in-memory bus.

### Lifecycle hooks (turned on and off)

The host can run a hook in an organization at four moments:

| Hook | When | Use it for |
| --- | --- | --- |
| `onEnabled` | An org admin turned the module on | Scaffolding, and catching up on what happened while it was off (events aren't delivered to a module that isn't on) |
| `onDisabled` | An org admin turned it off (or the organization was removed) | Light cleanup, like cancelling scheduled work. Never delete data here. |
| `onDataRemoved` | An org admin chose **Remove data** on the Modules page, which is only possible while the module is off | Cleaning up what the host can't see, like derived state. Afterwards the host deletes all your records in the organization, removed ones too, whatever the hook did. |
| `onUpgraded` | A new version of your plugin is installed; the host notices at startup | Migrating the organization's records. Runs in each organization where the module is on, which **stays on meanwhile**, so keep old and new record shapes working until it's done. |

Declare each hook in the manifest and register it in `onModuleInit`, like an event subscription.
Registering an undeclared hook throws `PluginUndeclaredLifecycleHookError`.

```ts
// manifest
lifecycle: { onEnabled: true },

@Injectable()
export class WelcomeCatchUp implements OnModuleInit {
  constructor(private readonly lifecycle: ModuleLifecycleProxy, private readonly users: UsersProxy,
              private readonly notes: NotesService) {}

  onModuleInit(): void {
    this.lifecycle.onEnabled(async (event) => {
      // Runs in the organization it was turned on in: only its members are found, notes are stored there
      for (let skip = 0; ; ) {
        const page = await this.users.findMembers({ limit: 100, skip });
        await this.notes.ensureWelcomeNotes(page.items);   // skips members who already have one
        skip += page.items.length;
        if (page.items.length === 0 || skip >= page.total) break;
      }
    });
  }
}
```

Each hook gets a `ModuleLifecycleEvent`:

```ts
interface ModuleLifecycleEvent {
  organizationId: string;          // also tenant() while the hook runs
  firstTime: boolean;              // onEnabled: never on in this organization before
  lastEnabledAt: string | null;    // when it last finished being turned on / off here (ISO)
  lastDisabledAt: string | null;
  pluginVersion: string;           // your version now, and the one that last ran here (null if unknown)
  lastPluginVersion: string | null; // onUpgraded: the version upgraded from
  attempt: number;                 // 1, then 2, 3… on retries
}
```

- **When the module is on.** If you declare `onEnabled`, the module is only on in the organization once it has
  succeeded: requests are refused and events aren't delivered until then. Without one it's on right away.
  Turning the module off takes effect at once, and `onDisabled` runs afterwards.
- **How hooks run.** Without an acting user, in the organization (`tenant()`, with everything confined to it as
  in §9), within `limits.lifecycleHookTimeoutMs` (default 60 s).
- **Failures are retried.** A failing or timed-out hook is retried with a growing delay (5 s, 10 s, 20 s… up to
  an hour). The Modules page shows the error and a Retry button. **Make hooks idempotent**: they can run more
  than once, and a timed-out one keeps running in the background.
- **Changes collapse.** If the module is turned back before a hook ran, nothing runs. If it's turned off while
  `onEnabled` runs, `onDisabled` follows.
- **Don't delete data in `onDisabled`.** Turning the module back on should find everything as it was.
- **Removing an organization** turns its modules off, so `onDisabled` runs there.
- **After Remove data**, the module starts from scratch in the organization: the next `onEnabled` there has
  `firstTime: true`. It can't be turned on until the removal is done. If `onDataRemoved` fails, the data is
  kept until a retry succeeds.
- **Upgrades:** where the module is off, `onUpgraded` doesn't run; the next `onEnabled` there sees the
  version change (`lastPluginVersion`). Where the previous version is unknown (e.g. seeded data), the new
  version is just recorded. Without an `onUpgraded` hook, the version is also just recorded. A failed
  `onUpgraded` is retried like the others, with the module still on.

---

## 12. Building the UI

A plugin may ship a Vue 3 UI for the SPA: pages, menu entries, stores and translations, styled with Tailwind
and PrimeVue. It's optional. The code lives in `src/ui`, is published as the package's `./ui` entry, and is
**bundled into the SPA at build time**. It runs in the SPA's JavaScript context: the boundary is a contract
enforced by lint and review, not a sandbox. Checks in the UI are for the user's convenience. The API enforces
everything again on each request.

### Defining the UI

Bind the SDK to your manifest once, then default export the definition from `src/ui/index.ts`:

```ts
// src/ui/plugin.ts
import { createPluginUi } from '@unifyamerica/demleague-plugin-sdk/vue';
import { ACME_NOTES_MANIFEST } from '../manifest';

export const notesUi = createPluginUi(ACME_NOTES_MANIFEST);
export const { useAbility, useApi, useConfirm, useCurrentOrganization, useI18n, useToast } = notesUi;
```

```ts
// src/ui/index.ts
import en from './i18n/en';
import { notesUi } from './plugin';

export default notesUi.define({
  routes: [
    {
      path: '',                                            // /apps/acme/notes
      name: 'list',
      component: () => import('./pages/NotesPage.vue'),    // lazy: its own chunk
      ability: { action: 'read', subject: 'Note' },
      titleKey: 'pages.notes.title',
    },
    {
      path: 'overview',
      name: 'overview',
      component: () => import('./pages/OverviewPage.vue'),
      ability: { action: 'read', subject: 'Overview' },    // granted to org admins only
      titleKey: 'pages.overview.title',
    },
  ],
  mainMenu: [{ labelKey: 'nav.notes', icon: 'pi pi-book', to: 'list' }],
  profileMenu: [{ labelKey: 'nav.overview', icon: 'pi pi-chart-bar', to: 'overview' }],
  i18n: { en },
});
```

`define()` validates the options against the manifest and throws `Invalid UI for plugin <namespace>: ...`
listing every problem:

- the manifest itself is valid
- route names are kebab-case and unique, children included
- each route's `ability.subject` is declared in `manifest.abilities`
- `mainMenu` / `profileMenu` items need their slot in `manifest.ui.slots`; each is a link whose `to` names a
  route, or a group whose `children` (one level, at least one) do

The composables (`useApi()`, `useI18n()`, ...) need the SPA's host, so call them at runtime (in `setup()`, a
store or a handler), never when a module is first evaluated.

### Routes and pages

| Field | Meaning |
| --- | --- |
| `path` | Relative to `/apps/<vendor>/<module>`: `''` for the home page, `'settings'`, `':id'`. |
| `name` | kebab-case, unique in the plugin. Navigate by this name. |
| `component` | A component, preferably lazy (`() => import('./pages/X.vue')`). |
| `ability` | `{ action, subject }` on one of your own subjects, checked in the current organization. Omitted: any logged-in user. Children inherit it. |
| `titleKey` | Message key for the document title. |
| `children` | Nested routes. |

A page opens only while the API has the plugin loaded and for users who hold its ability in the current
organization. Otherwise the user sees the SPA's not-authorized page. Plugin pages carry the organization in
`?org=<slug>`, so links can be shared. Pages are re-created when the user switches organization, and an
error thrown while rendering a page is caught and shown by the SPA without breaking the rest of the app.

Navigate among your own routes with `useRouter()`: `push({ name: 'list' })`, `to({ name, params })` for a
`RouterLink`, and `route` (a computed of the current, unprefixed route name, params and query). Both keep
the current organization.

### Menus and slots

`mainMenu` and `profileMenu` items are `{ labelKey, icon, to }`: a message key, a PrimeIcons class
(`pi pi-book`) and a route name. An item is shown only to users who may open its target page, and only if its
slot is declared in `manifest.ui.slots` and approved in the registry (`approvedUiSlots`).

**Sub-navigation.** An item can instead be a group: `children` in place of `to`, each child a link
`{ labelKey, icon?, to }` (one level, no deeper). In the sidebar a group expands in place, and it's open
while one of its pages is (child routes included). In the profile menu it's a heading over its links. Each
link follows the rule above, and a group is hidden when none of its links is shown.

```ts
mainMenu: [
  {
    labelKey: 'nav.notes',
    icon: 'pi pi-book',
    children: [
      { labelKey: 'nav.all', to: 'list' },
      { labelKey: 'nav.pinned', icon: 'pi pi-star', to: 'pinned' },
      { labelKey: 'nav.overview', to: 'overview' }, // only org admins see it (the page's ability)
    ],
  },
],
```

For tabs or other navigation inside your own pages, use nested `children` routes and render them with a
`RouterView` in the parent page: no menu entry is needed.

### Abilities in the UI

```ts
const { can } = useAbility();
```

```vue
<Button v-if="can('create', 'Note')" :label="t('pages.notes.new')" @click="startAdding" />
```

`can(action, Subject)` checks your own subjects in the current organization, reactively. Use it to hide what
the user can't do. It isn't a security check.

### API calls and the current organization

```ts
const api = useApi();
const page = await api.get<NotesPage>('/notes', { params: { limit: 100 } });
await api.patch<Note>(`/notes/${id}`, { pinned: true });
```

- Paths are relative to `/plugins/<vendor>/<module>`, start with `/` and can't contain `..`. Only your own
  endpoints are reachable.
- Each request carries the user's session and the current organization as `X-Tenant`.
- Methods: `get`, `post`, `put`, `patch`, `delete`. They resolve with the response body and reject with an
  `Error` whose message can be shown: pass it to `useToast().error(error)`.
- `useCurrentOrganization()` and `useCurrentUser()` are read-only computed refs. The organization can be
  `null`, so handle that case. The user's `memberships` are active ones only (there are no system roles).
- `useToast()` has `success`, `info`, `warn` and `error`. `useConfirm()` returns a function that opens the
  SPA's confirmation dialog and resolves to `true` or `false`.

### Stores

Use `defineStore` from your `createPluginUi()` object, not Pinia directly. It creates a Pinia setup store whose
id is prefixed with your namespace (`acme.notes/notes`):

```ts
export const useNotesStore = notesUi.defineStore('notes', () => {
  const api = useApi();
  const notes = ref<Note[]>([]);
  async function load() { notes.value = (await api.get<NotesPage>('/notes')).items; }
  function reset() { notes.value = []; }   // call when a page mounts: never show another org's data
  return { notes, load, reset };
});
```

`storeToRefs` is re-exported from `@unifyamerica/demleague-plugin-sdk/vue`. Stores outlive page remounts, so reset
organization-specific state when a page mounts.

### Messages (i18n)

Put messages in `i18n`, keyed by locale (`{ en }`), and translate with `useI18n().t(key, params)`.
Placeholders use `{name}`: `t('pages.notes.subtitle', { organization: org.name })`. A plugin only reaches its
own messages. The SPA files them under `plugins.<vendor>.<module>`.

### Styling

- Style with **Tailwind utility classes** and **PrimeVue components** imported one by one
  (`import Button from 'primevue/button'`), and PrimeIcons classes for icons. The theme's `surface-*` and
  `primary-*` colors are available (`text-surface-500`, `bg-surface-0`).
- The SPA's Tailwind scans `node_modules/@unifyamerica/demleague-plugin-*/dist/ui/*.js`, so the classes in your built
  code are generated. Write class names in full, not assembled from fragments.
- If the package ships a stylesheet, tell the core team for the install PR: the SPA imports it in
  `frontend/src/plugins.config.ts`.

### Build output

`npm run build` runs `vite build` (library mode, ES modules) into `dist/ui`: `index.js` plus one chunk per
lazy page, and a `package.json` marking the folder as ES modules. `vue`, `pinia`, `primevue`, `primeicons` and
`@unifyamerica/demleague-plugin-sdk` stay external. `vue-tsc -p tsconfig.ui.json` writes declarations to `dist/ui-types`.
`package.json` `exports["./ui"]` points to both. Testing the UI is covered in [§15](#15-testing).

---

## 13. Resource limits

Declare what your plugin needs in `manifest.limits`. Each effective limit is
`min(declared ?? default, registry ceiling ?? default, platform maximum)`. Declaring a limit can only
**lower** what you get. Going above a default needs a registry ceiling from the core team.

| Limit | Default | Platform max | Enforcement |
| --- | --- | --- | --- |
| `requestsPerMinute` | 600 | 6,000 | Whole plugin, 429 `PLUGIN_QUOTA_EXCEEDED` |
| `requestsPerMinutePerUser` | 120 | 6,000 | Per authenticated user, 429. Public endpoints count only towards `requestsPerMinute`. |
| `dbOperationsPerMinute` | 1,200 | 12,000 | Whole plugin, 429 |
| `requestTimeoutMs` | 10,000 | 30,000 | The response fails with 503. **Your handler keeps running.** |
| `eventHandlerTimeoutMs` | 5,000 | 30,000 | Logged as a handler error |
| `lifecycleHookTimeoutMs` | 60,000 | 600,000 | Per lifecycle hook. The hook counts as failed and is retried. **It keeps running.** |
| `maxDocumentBytes` | 64 KB | 1 MB | Per document, 413 |
| `maxDocuments` | 10,000 | 1,000,000 | Live documents across all your collections, 507 `PLUGIN_STORAGE_QUOTA_EXCEEDED` |
| `maxStorageBytes` | 50 MB | 5 GB | Live bytes across all your collections, 507 |
| `maxMemoryMb` | 128 | 512 | Advisory only |

**For planning:** size `maxDocuments` and `maxStorageBytes` from expected users × records per user ×
average record size, then add headroom. If the numbers exceed the defaults, raise it with the core team
early, since ceilings are a review decision.

---

## 14. Errors

All SDK errors extend `PluginSdkError` and carry `code` and `status`. If one escapes a handler, the host
turns it into a JSON:API error response. You usually don't need to catch them.

| Error | Status | Code | Typical cause |
| --- | --- | --- | --- |
| `PluginValidationError` | 400 | `PLUGIN_VALIDATION_ERROR` | Disallowed filter operator, bad document key, bad `limit`, malformed `id` in a filter, > 100 ids |
| `PluginPermissionDeniedError` | 403 | `PLUGIN_PERMISSION_DENIED` | Plugin lacks the permission |
| `PluginActorForbiddenError` | 403 | `PLUGIN_ACTOR_FORBIDDEN` | Acting user isn't allowed |
| `PluginPayloadTooLargeError` | 413 | `PLUGIN_PAYLOAD_TOO_LARGE` | Document or event payload too big |
| `PluginQuotaExceededError` | 429 | `PLUGIN_QUOTA_EXCEEDED` | Rate limit hit |
| `PluginStorageQuotaExceededError` | 507 | `PLUGIN_STORAGE_QUOTA_EXCEEDED` | `maxDocuments` / `maxStorageBytes` reached |
| `PluginUndeclaredCollectionError` | 500 | `PLUGIN_UNDECLARED_COLLECTION` | Collection not in the manifest |
| `PluginUndeclaredEventError` | 500 | `PLUGIN_UNDECLARED_EVENT` | Event not in `emits` / `subscribes` |
| `PluginManifestError` | 500 | `PLUGIN_MANIFEST_INVALID` | Invalid manifest (at load time) |

Response body shape:

```json
{ "errors": [{ "status": "403", "code": "PLUGIN_PERMISSION_DENIED", "title": "Forbidden", "detail": "..." }] }
```

For 5xx errors the `detail` is just `"Plugin error"`, and the specifics go to the server logs.

---

## 15. Testing

Unit tests are **required** with every submission. Server code is tested with Jest, the UI with Vitest;
`npm test` runs both.

### Server tests

Use the harness from `@unifyamerica/demleague-plugin-sdk/testing`. It wires your plugin the way the host does, with
in-memory proxies that enforce the same manifest rules: permissions, declared collections and events,
document safety and size, storage limits, and per-organization data isolation.

```ts
import { createPluginTestHarness, PluginTestHarness } from '@unifyamerica/demleague-plugin-sdk/testing';

let harness: PluginTestHarness;

beforeEach(async () => {
  harness = await createPluginTestHarness(AcmeNotesPlugin, {
    actor: { id: 'aaaaaaaaaaaaaaaaaaaaaaaa', memberships: [{ organizationId: 'o1', roles: ['member'] }] }, // default null
    tenant: { id: 'o1', name: 'Org', slug: 'org', description: null },          // X-Tenant, default null
    users: [{ id: 'u1', firstName: 'Ada', lastName: 'Lovelace', memberships: [] }],
    organizations: [{ id: 'o1', name: 'Org', slug: 'org', description: null }],
    permissions: ['data:read'],      // optional: override the manifest's to test denials
  });
});
afterEach(() => harness.close());
```

| Harness member | Use |
| --- | --- |
| `harness.module.get(MyService)` | Your providers |
| `harness.context.setActor(actor \| null)` | Switch user, or simulate a public request. Like the host, `actor()` only returns their membership in the current tenant (none without one) |
| `harness.context.setTenant(org \| null)` | Simulate the `X-Tenant` header |
| `harness.users.users` / `harness.organizations.organizations` | Backing `Map`s for fixtures |
| `harness.data.store.get('notes')` | Raw records by collection, **including soft-deleted ones** (`isEnabled: false`) |
| `harness.data.usage` | `{ documents, bytes }` counted against storage limits |
| `await harness.events.deliver(name, payload, source?, organizationId?)` | Delivers an event like the host does (actor `null`, run in the event's organization: `organizationId` from a core payload, else the argument) and rejects with the first handler error. It doesn't check the module is turned on |
| `await harness.lifecycle.enable(orgId, event?)` / `disable(orgId, event?)` | Runs your `onEnabled` / `onDisabled` hooks like the host does (actor `null`, in that organization), with `event` overriding the `ModuleLifecycleEvent` defaults. Rejects with the first error. Call it twice to check a hook is idempotent |
| `await harness.lifecycle.removeData(orgId, event?)` | Runs `onDataRemoved`, then deletes the organization's records from `harness.data` like the host does |
| `await harness.lifecycle.upgrade(orgId, event?)` | Runs `onUpgraded` in that organization (set `lastPluginVersion` in `event`) |
| `harness.lifecycle.registeredHooks()` | The hooks your plugin registered |
| `harness.events.emitted` | Events your plugin emitted |
| `harness.events.subscribedEvents()` | Event names your plugin subscribed to |
| `harness.logger.messages` | `{ level, message }[]` |

Use `createPluginTestingModule(Plugin, options)` instead when you need `.overrideProvider()` before
compiling.

**What the harness doesn't reproduce:** the acting user's own platform permissions, `@RequireAbility()`, rate
limits and registry approvals and ceilings. Those are host-only, so cover those paths in review or end-to-end
tests against a local DemLeagueOS.

**Minimum test set expected in review:**

- `manifest.spec.ts`: valid manifest, version equal to `package.json`
- each service's happy paths, including pagination and filtering
- ownership and tenant isolation (another user's record → 404; another tenant's records are invisible)
- a permission denial (`permissions` override → `PluginPermissionDeniedError`)
- each event listener via `harness.events.deliver`, including the "record not found" path and the
  organization each record lands in
- emitted events (`harness.events.emitted`)
- if there's a UI: the UI definition is valid (importing `src/ui/index.ts` runs `define()`), and each page's
  main paths, including what it hides without an ability and without an organization

### UI tests

`vitest.config.mts` runs `src/ui/**/*.spec.ts` in jsdom. `@unifyamerica/demleague-plugin-sdk/vue/testing` installs a fake
host in place of the SPA:

```ts
import { installTestPluginHost, uninstallTestPluginHost } from '@unifyamerica/demleague-plugin-sdk/vue/testing';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import PrimeVue from 'primevue/config';

afterEach(() => uninstallTestPluginHost());

it('lists notes', async () => {
  const host = installTestPluginHost({
    organization: { id: 'o1', name: 'Acme', slug: 'acme', description: null },
    abilities: ['read Note', 'delete Note'],        // default: everything
    responses: { 'GET /notes': { items: [], total: 0, limit: 100, skip: 0 } },
  });
  const pinia = createPinia();
  setActivePinia(pinia);
  mount(NotesPage, { global: { plugins: [pinia, PrimeVue] } });
  await flushPromises();

  expect(host.requests[0]).toMatchObject({ method: 'GET', path: '/notes' });
});
```

| Option / member | Use |
| --- | --- |
| `responses` | By `METHOD path`. A value is returned (cloned), a function gets `(body, params)`. Missing ones reject with `No test response for ...`. |
| `user`, `organization` | The current user and organization (default `null`). Also writable refs on the host. |
| `abilities` | `'<action> <Subject>'` strings the user holds, or `'*'`. |
| `confirm` | The answer to every confirmation dialog (default `true`). |
| `host.requests` / `toasts` / `navigations` | What the UI did. |

`t()` returns the key, so assert on keys. Importing `src/ui/index.ts` in a test runs `define()`, which
validates the UI against the manifest.

### Local end-to-end (optional)

Vendors don't have DemLeagueOS, so the SDK's harnesses are your test bed. With access to DemLeagueOS (the
core team), build and `npm pack` the plugin, install the tarball in the API (`npm install <path>.tgz -w api`,
and `-w frontend` for a UI), register it in `api/src/plugins.config.ts` and `api/namespace-registry.json` (and
its UI in `frontend/src/plugins.config.ts`), then run `npm run dev`. Don't commit any of it: the install PR
pins the released version. Swagger at `http://localhost:3000/api` lists your endpoints, and `GET /plugins` shows the effective limits and
usage.

---

## 16. Publishing and installation

Plugins are only published by the org's release workflow
(`plugin-release.yml` in the public
[unifyamerica/demleague-plugin-workflows](https://github.com/unifyamerica/demleague-plugin-workflows)
repository, whose `main` is protected), which your module repo calls on a version tag (the caller is in [§4](#4-quick-start)). Don't `npm publish` yourself: CI only installs a package that
workflow built and attested.

1. **Version:** bump `package.json` and `manifest.version` together, following semver, and merge it.
2. **Check locally:** `npm run lint`, `npm run type-check`, `npm test` and `npm run build` (outputs `dist/`,
   plus `dist/ui` and `dist/ui-types` for a UI, without specs). The template's build clears `dist/` first, so
   files from removed sources never ship.
3. **Tag the release:** `git tag v0.2.0 && git push origin v0.2.0` in your module repo. The tag must be
   `v<package.json version>`. The release workflow runs two jobs:
   - **Check, build and pack** (read-only): checks the repo is named `demleague-plugin-<vendor>-<module>`, the
     package `@unifyamerica/<repo name>`, the tag `v<version>`, `publishConfig.registry` GitHub Packages, the
     SDK a peer dependency and the scripts present; then `npm ci`, lint, type-check, tests, build, checks that
     `manifest.version` equals the package's, and runs `npm pack`.
   - **Attest and publish** runs none of your code: it re-checks the tarball's name and version against the
     repo and tag, attests it (SLSA build provenance, signed with Sigstore through GitHub), publishes it to
     GitHub Packages with `npm publish --ignore-scripts`, and writes the tarball's sha256 and attestation link
     to the job summary.

   Only the second job can sign, so your build and test scripts never get the identity that attests a
   package, and can't get arbitrary files attested.
4. **Ask the core team to install it**, with the registry request (permissions, public endpoints, ability
   grants, UI slots, raised limits and why). You have no access to DemLeagueOS: the core team opens the
   install PR, which:
   - pins the **exact** version in `api/package.json` (no `^` or `~`)
   - adds `{ package: '@unifyamerica/demleague-plugin-<vendor>-<module>', module: <YourPluginClass> }` to
     `INSTALLED_PLUGINS` in `api/src/plugins.config.ts`
   - if there's a UI: pins the same exact version in `frontend/package.json` and adds your `./ui` default
     export to `INSTALLED_PLUGIN_UIS` in `frontend/src/plugins.config.ts` (plus your stylesheet import, if any)
   - adds or updates your entry in `api/namespace-registry.json`:

```json
"myvendor.tasks": {
  "package": "@unifyamerica/demleague-plugin-myvendor-tasks",
  "owner": "My Vendor <plugins@myvendor.example>",
  "tier": "community",
  "enabled": true,
  "approvedPermissions": ["data:read", "data:write"],
  "approvedPublicEndpoints": [],
  "approvedAbilityGrants": {
    "Task": { "organization": { "member": ["read", "create"] } }
  },
  "approvedUiSlots": ["main-menu"],
  "limits": { "maxDocuments": 50000 },
  "notes": "Why the plugin exists, and why it needs each permission"
}
```

### What CI checks on your PR

Two GitHub Actions workflows run on the install PR:

- **Plugin contract** (`.github/workflows/plugin-contract.yml`), when the PR touches plugin pins, config or
  the registry:
  1. `npm audit signatures`: the dependencies installed from the npm registry carry valid registry
     signatures. (It doesn't cover GitHub Packages; the next step does.)
  2. `scripts/ci/check-plugins.mjs`:
     - The pins are exact, and the API and the SPA pin the same version.
     - The package is in both `plugins.config.ts` files and has a registry entry.
     - Provenance: GitHub Packages' tarball for that version (`npm pack` downloads it) has the integrity
       recorded in `package-lock.json`, and `gh attestation verify` accepts it as built by the org's release
       workflow from `main`, from the `v<version>` tag of `unifyamerica/<package name without the scope>`, on
       a GitHub-hosted runner. So it's the very tarball installed, built from that exact tag of the repo named
       like the package. A locally linked package (`npm link`) skips it.
     - The SDK gets the same pin and provenance checks: one exact version in both `package.json` files,
       installed, and its tarball attested by `unifyamerica/demleague-plugin-sdk`'s own release workflow
       (`release.yml`) from its `v<version>` tag.
     - The template's lint guardrails hold for the code you **shipped** (`dist/`): only the allowed imports,
       and no `process.env`, `eval` or `Function` constructor.
     - Its job summary shows what your manifest asks for next to what the registry approves.
  3. The boot gate (`api/src/plugins.config.spec.ts`): the same check the API runs at startup.
  4. The SPA's module tests, which load your `./ui` entry.
- **CI** (`.github/workflows/ci.yml`): lint, type-check, unit tests (the boot gate included), the API's
  e2e suite and the seed script.

Both read the plugin packages from GitHub Packages with `PLUGINS_READ_TOKEN` (an org-wide read token, if the
core team sets that secret) or else the job's own token, which reads public packages (the SDK, and modules
released from public repositories) and any private package that grants DemLeagueOS read access.

The core team owns the registry file. They set `tier` and the limit ceilings, and may change your request.
Explain each permission, public endpoint, ability grant, UI slot and raised limit in your request; the core
team carries it into the PR description.
`approvedAbilityGrants` has the manifest's `abilities` shape and must cover every grant (an approved `manage`
covers any action). Subjects with no grants (`{}`) need no entry.

### Setting up a module repo (core team)

The step-by-step setup (organization settings, repository, access grants, offboarding) is in the
DemLeagueOS README (internal to the core team), under "Onboarding a plugin vendor". In short:

- Create `unifyamerica/demleague-plugin-<vendor>-<module>` as a **public** repository (see the note in
  [§3](#3-how-a-plugin-gets-into-production): on the org's Team plan a private repo's release can't be
  attested, so private module repos can't be released or installed until the core team picks an approach),
  as a copy of [demleague-plugin-acme-notes](https://github.com/unifyamerica/demleague-plugin-acme-notes) with
  the release caller in `.github/workflows/release.yml`, and add the vendor as an
  **outside collaborator on that repository only**, never as an organization member. With the organization's
  base permission at "No permission", they see nothing else.
- The release workflow is in a public repository, so module repos can call it with no Actions access setting.
- The SDK package is public: the module repo's release workflow and the vendor only need a token with
  `read:packages`.
- A package released from a public module repo is public too, so DemLeagueOS's checks can install it and read
  its attestations with their own job token. (A private package would need DemLeagueOS added under its
  package settings → Manage Actions access, or the org-wide `PLUGINS_READ_TOKEN` secret.)

---

## 17. Submission checklist

**Contract**
- [ ] Namespace agreed with the core team, `<vendor>.<module>`, and not a reserved vendor
- [ ] Package named `@unifyamerica/demleague-plugin-<vendor>-<module>`, and `index.ts` exports the plugin class and manifest
- [ ] `manifest.version` equals `package.json` version
- [ ] SDK, `@nestjs/common`, `class-validator`, `class-transformer`, `reflect-metadata` are **peerDependencies**
- [ ] Only the minimum permissions are declared, each one justified in the registry request
- [ ] Every route is declared, with a `summary`, and public endpoints are justified
- [ ] Limits are declared and sized, and any need above the defaults is explained
- [ ] Lifecycle hooks (if any) are declared in `manifest.lifecycle`, idempotent, tested with
      `harness.lifecycle`, and `onDisabled` doesn't delete the organization's data
- [ ] An `onUpgraded` migration keeps both record shapes working while it runs (the module stays on)
- [ ] Ability grants are the fewest that work, and each is justified; org-admin-only features grant `org_admin` on their own subject
- [ ] UI slots are declared only for menus the UI uses

**Code**
- [ ] Imports only from the allowed packages (server and UI); no `process.env`, `eval`, `require`, or `console`
- [ ] Injects only SDK proxies and the plugin's own providers
- [ ] Every body and query input uses a `class-validator` DTO with length and range bounds
- [ ] Every user-facing endpoint is guarded with `@RequireAbility()` where not every user may use it
- [ ] Private data is scoped by owner; tenant scoping is left to the host
- [ ] Other users' records return 404
- [ ] Event handlers tolerate missing records, don't assume an actor or tenant, and pass `organizationId` on insert
- [ ] No PII in logs or in public endpoint responses

**Quality**
- [ ] `npm test`, `npm run lint`, `npm run type-check`, `npm run build` all pass
- [ ] Tests cover the minimum set in §15
- [ ] UI: pages are lazy, every page has an `ability` unless open to all users, and actions the user can't
      take are hidden with `can()`

**Release**
- [ ] Module repo named `demleague-plugin-<vendor>-<module>`, `package.json` `repository` points at it, and
      `publishConfig.registry` is `https://npm.pkg.github.com`
- [ ] Released by pushing a `v<version>` tag: the org's release workflow built, attested and published it
      (never `npm publish` by hand)
- [ ] Registry request (permissions, endpoints, grants, slots, limits, with reasons) sent to the core team
- [ ] Install PR (opened by the core team) has the exact version pins, `plugins.config.ts` entries (API, and
      SPA if UI) and the registry entry
- [ ] The **Plugin contract** and **CI** checks pass on the PR

---

## 18. Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `Invalid plugin manifest for X: ...` on import | `validateManifest` problems | Read the listed problems. Run `manifest.spec.ts`. |
| API refuses to start: plugin built with another SDK copy | SDK listed in `dependencies` | Move it to `peerDependencies`, then reinstall. |
| API refuses to start: route not declared, or declared endpoint missing | Controller and manifest are out of sync | Make `@Controller` + handler paths match `endpoints[].path` exactly. |
| API refuses to start: `X injects Y, which is not an SDK service...` | Injected a core service, `ModuleRef`, a DB connection, or a provider not listed in `providers` | Only inject SDK proxies and your own providers, and add them to `providers`. |
| API refuses to start: permission / public endpoint not approved | Registry entry is missing or outdated | Request approval in `namespace-registry.json`. |
| API refuses to start: `ability grant Note.organization.member: read is not in approvedAbilityGrants` or `UI slot "main-menu" is not in approvedUiSlots` | Grant or slot not approved | Request it in `namespace-registry.json`, or remove it from the manifest. |
| API refuses to start: `X.list requires an ability on "Y", which is neither a platform subject nor declared in manifest.abilities` | `@RequireAbility()` subject typo, or subject not declared | Declare it in `manifest.abilities`, with the organization roles that may use it. |
| 400 `TENANT_REQUIRED` on an authenticated endpoint | No `X-Tenant` | Send the tenant (the UI's `useApi()` does). |
| 403 on an endpoint with `@RequireAbility()` on your own subject | The user lacks the role in that organization, or the subject has no grants (`{}`) | Check the grants. |
| 400 `An event's organizationId must be the organization it's emitted in` | `emit()` with a payload `organizationId` other than the current organization's | Drop the field (subscribers get `event.organizationId`), or emit from that organization. |
| Records "disappear" between requests | They belong to another tenant, or were stored without one | Expected: data is isolated per organization. |
| `Invalid UI for plugin X: ...` in the SPA or a test | `define()` found problems | Fix the listed routes, abilities, slots or menu targets. |
| `The DemLeagueOS plugin host is not installed` | Composable called at module evaluation, or a UI test without `installTestPluginHost()` | Call composables in `setup()`, stores or handlers. Install the test host in tests. |
| `Invalid plugin API path` | `useApi()` path doesn't start with `/` or contains `..` | Use paths relative to your base, e.g. `/notes`. |
| Plugin page shows "not authorized" | API hasn't loaded the plugin, the user lacks the page's ability in the current organization, or `?org=` names an organization they can't act in | Check the API logs, the grants and the organization. |
| Menu entry missing | Slot not in `manifest.ui.slots` or not approved, or the user can't open the target page | Declare and request the slot, check the page's `ability`. |
| Tailwind classes have no effect | Class names assembled at runtime, so absent from `dist/ui` | Write class names in full. |
| Validation doesn't run, and extra fields pass through | Second copy of `class-validator` | Make it a peer dependency. |
| Query param `limit` fails `@IsInt` | Query strings are strings | Add `@Type(() => Number)`. |
| 403 `PLUGIN_PERMISSION_DENIED` | Permission not declared or not approved | Add it to the manifest and request approval. |
| 403 `PLUGIN_ACTOR_FORBIDDEN`, or `findByIds` returns fewer users than expected | The acting user can't access those records | Expected behavior. Plugins act within the user's rights. |
| 500 `PLUGIN_UNDECLARED_COLLECTION` / `_EVENT` | Name used in code isn't in the manifest | Declare it, and share constants between code and manifest. |
| 400 `Operator "$regex" is not allowed` | Unsupported query operator | Use the supported subset, or prefix-match with `$gte`/`$lt` ranges. |
| 507 storage quota | `maxDocuments` / `maxStorageBytes` reached | Remove old data, or request a higher ceiling. |
| 503 after N seconds | `requestTimeoutMs` exceeded | Paginate, batch, or move the work into an event handler. |
| Release workflow fails `Package matches the repository and the tag` | Repo not named `demleague-plugin-<vendor>-<module>`, `name` isn't `@unifyamerica/<repo name>`, tag isn't `v<version>`, `repository` doesn't point at the module repo (or has a `directory`), wrong `publishConfig.registry`, SDK not a peer, or a script missing | Fix what the error lists, then delete and push the tag again. |
| Release workflow fails at the attestation step | The module repository is private: on the org's Team plan, attestations only work in public repositories | Ask the core team; see the note in [§3](#3-how-a-plugin-gets-into-production). |
| `E401` / `E403` / `E404` from `npm.pkg.github.com` | No token in your user `~/.npmrc`, a token without `read:packages` (or a fine-grained token, which GitHub Packages' npm registry doesn't accept), or no read access to a private package (in CI: the package doesn't grant the repo access) | Add a classic token with `read:packages`; for a private package, ask the core team for access (Manage Actions access, or `PLUGINS_READ_TOKEN`). |
| Plugin contract: `no valid attestation from the release workflow` | Published outside the release workflow (by hand, another workflow, a self-hosted runner), from a tag other than `v<version>`, or from a repo not named like the package | Release again by pushing a `v<version>` tag of `unifyamerica/demleague-plugin-<vendor>-<module>`, with a new version. |
| Plugin contract: `the registry's tarball doesn't match package-lock.json's integrity` | The lockfile was resolved against another tarball | Reinstall the exact version so `package-lock.json` matches GitHub Packages. |
| Event handler never fires in a test | Subscription not in `onModuleInit`, or listener not in `providers` | Register it in `providers`, and subscribe in `onModuleInit`. |

---

## 19. Known limitations

These come from the current in-process plugin model. They're listed so you can plan around them:

- **Same process as the API.** Memory (`maxMemoryMb`) is advisory, and a timed-out handler keeps running.
  Avoid CPU-heavy work and unbounded loops.
- **No configuration or secrets API.** There's no `process.env`, so hard-coding vendor secrets is not
  acceptable. Raise configuration needs with the core team.
- **No outbound integration API.** The SDK has no HTTP client capability. Discuss external calls with the
  core team before designing around them.
- **No indexes** on plugin collections.
- **Events are in-memory**, with no durability or replay. Events in an organization where your module is
  still being set up (`onEnabled` running) aren't delivered, so catch up on state in `onEnabled` rather than
  replaying events. Lifecycle hooks are durable: they're retried until they succeed.
- **A timed-out lifecycle hook keeps running** while the host retries it, so a retry can overlap the previous
  attempt. Keep hooks idempotent and their batches bounded.
- **Rate limits** are per API instance unless the platform runs Redis.
- **The UI is a contract, not a sandbox.** Plugin UI code runs in the SPA's JavaScript context. What it may
  import is enforced by lint and review, as on the API.
- **The UI is bundled at build time.** There's no runtime or remote loading: installing or updating a UI
  ships with the next SPA build.
- **Two UI slots** (`main-menu`, `profile-menu`). Ask the core team for more.
- **Ability grants are per organization role** (`member`, `org_admin`); there are no system-wide roles. There are
  no per-record conditions beyond the organization: check ownership in your code.

---

## 20. Versioning and compatibility

- `@unifyamerica/demleague-plugin-sdk` follows semver independently of the API. It's released to GitHub
  Packages from a `v<version>` tag of
  [unifyamerica/demleague-plugin-sdk](https://github.com/unifyamerica/demleague-plugin-sdk) (its own
  `.github/workflows/release.yml`, attested like plugins:
  `gh attestation verify <tgz> --repo unifyamerica/demleague-plugin-sdk`). DemLeagueOS pins it exactly, like a
  plugin.
  - **Patch:** fixes, better error messages.
  - **Minor:** new proxy methods, new core events, new optional manifest fields (as `abilities` and `ui`
    were), new grantable organization roles.
  - **Major:** removed or renamed methods, changed DTO shapes, new required manifest fields. Ships with a
    migration guide and a deprecation window.
- `SDK_API_VERSION` is bumped only on breaking changes. The host refuses plugins built against another API
  version, so you must rebuild and release a new version (a new tag).
- Everything exported from the SDK's entry points (`.`, `/testing`, `/manifest`, `/vue`, `/vue/testing`)
  is the contract, except `installPluginHost`, which only the SPA calls. Don't depend on internals or on host
  behavior that isn't documented here.

---

## 21. Glossary

| Term | Meaning |
| --- | --- |
| **Ability** | An action on a subject (`read Note`), granted to organization roles in the manifest and approved in the registry. |
| **Actor** | The authenticated user behind a request (`PluginActor`). `null` for public endpoints and events. |
| **Ceiling** | The core-team-approved maximum for a limit, in the registry. |
| **Collection** | A named store of documents owned by one plugin. |
| **Host** | The DemLeagueOS API, which loads and polices plugins. |
| **Manifest** | The plugin's declaration of what it needs. |
| **Module repo** | `unifyamerica/demleague-plugin-<vendor>-<module>`: one plugin's repository, where its vendor is an outside collaborator. |
| **Namespace** | `<vendor>.<module>`, the plugin's identity. |
| **Peer dependency** | A package the plugin uses but the host provides, so there's one shared copy. |
| **Proxy** | An SDK service through which a plugin reaches the platform, with checks applied. |
| **Registry** | `api/namespace-registry.json`, the core team's approvals. (Not to be confused with the npm registry, GitHub Packages.) |
| **Release workflow** | `.github/workflows/plugin-release.yml` in `unifyamerica/demleague-plugin-workflows`: the only way a plugin gets published and attested. |
| **SPA** | The DemLeagueOS web app, which bundles plugin UIs. |
| **Slot** | A place in the SPA's menus where a plugin may add entries (`main-menu`, `profile-menu`). |
| **Soft delete** | Records are hidden rather than erased, and stop counting towards quotas. |
| **Subject** | A kind of thing abilities apply to: the platform's (`User`, `Organization`) or the plugin's own (`Note`). |
| **Tenant** | The organization a request acts in (the `X-Tenant` header). Plugin data is isolated per tenant. |
| **Tier** | The registry's trust level: `first-party`, `verified` or `community`. |
| **UI definition** | What a plugin's `./ui` entry default exports: `createPluginUi(manifest).define({...})`. |
