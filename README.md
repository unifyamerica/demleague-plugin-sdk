# @unifyamerica/demleague-plugin-sdk

The contract between DemLeagueOS and plugin authors, and **the only platform package a plugin may import**.
It contains types, decorators, abstract service classes, the Vue UI contract and test harnesses. The
implementations live in the API and the SPA (the hosts). That separation is what lets the SDK be published and
plugins live in their own repos.

**Building a plugin?** Start with the [Plugin Developer Guide](PLUGIN_DEVELOPER_GUIDE.md): how a plugin gets
into production, the manifest, permissions, data, events, the UI, testing and releasing. The example plugin,
[demleague-plugin-acme-notes](https://github.com/unifyamerica/demleague-plugin-acme-notes), is the template;
[demleague-plugin-acme-tasks](https://github.com/unifyamerica/demleague-plugin-acme-tasks) shows one module
calling another.

| Entry | For | Format |
| --- | --- | --- |
| `@unifyamerica/demleague-plugin-sdk` | The plugin's API part: everything below | CommonJS |
| `@unifyamerica/demleague-plugin-sdk/testing` | API unit tests (Jest) | CommonJS |
| `@unifyamerica/demleague-plugin-sdk/manifest` | The manifest contract without NestJS, so the UI can import the manifest too | CommonJS + ESM |
| `@unifyamerica/demleague-plugin-sdk/vue` | The plugin's SPA UI | ESM |
| `@unifyamerica/demleague-plugin-sdk/vue/testing` | UI unit tests (Vitest) | ESM |

## Installing

The SDK is on GitHub Packages, not npmjs. A plugin's repo maps the scope in its `.npmrc` (the template has
it), and the token stays out of the repo, in your user `~/.npmrc`:

```ini
# <module repo>/.npmrc
@unifyamerica:registry=https://npm.pkg.github.com
# ~/.npmrc (a classic personal access token with read:packages)
//npm.pkg.github.com/:_authToken=<token>
```

Then `npm install -D @unifyamerica/demleague-plugin-sdk` and list it in `peerDependencies` too, as a range up
to the next major (`">=0.5.0 <1.0.0"`, not `^0.5.0`, which for `0.x` stops at the next minor; see Versioning). The package
is public, but GitHub Packages still needs a token to install from it. Plugins are named
`@unifyamerica/demleague-plugin-<vendor>-<module>` and live in a repo of the same name in the `unifyamerica`
org (see the [plugin developer guide](PLUGIN_DEVELOPER_GUIDE.md), §16). The example plugin,
[demleague-plugin-acme-notes](https://github.com/unifyamerica/demleague-plugin-acme-notes), is also the
template for new ones.

## A plugin in 30 seconds

```ts
@PluginModule({
  manifest: {
    sdkApiVersion: SDK_API_VERSION,
    namespace: 'acme.notes',                 // <vendor>.<module>, kebab-case
    version: '0.1.0',                        // keep in sync with package.json
    displayName: 'Notes',
    permissions: ['users:read', 'data:read', 'data:write'],
    endpoints: [
      { method: 'GET', path: '/notes' },     // relative to /plugins/acme/notes
      { method: 'GET', path: '/health', auth: 'public' },
    ],
    collections: ['notes'],                  // stored as plugin_acme_notes_notes
    events: { emits: ['acme.notes.note-created'], subscribes: ['core.organization.member-added'] },
    limits: { requestsPerMinute: 120, requestsPerMinutePerUser: 60, maxDocuments: 10_000 },
    // Who may do what with your data, per organization role ({} = nobody)
    abilities: {
      Note: { organization: { member: ['read', 'create'] } },
      Overview: { organization: { org_admin: ['read'] } },
    },
    ui: { slots: ['main-menu'] },            // SPA menus your UI adds entries to
  },
  controllers: [NotesController, HealthController],
  providers: [NotesService],
})
export class AcmeNotesPlugin {}
```

Inject what you need (`UsersProxy`, `DataProxy`, `EventBusProxy`, `ModuleLifecycleProxy`, `ModuleCallsProxy`,
`PluginContext`, `PluginLogger`) like any provider. Get the caller with `@CurrentActor()`, and the organization the request
acts in (the `X-Tenant` header) with `PluginContext.tenant()`. Authenticated endpoints always have one (the
host answers 400 without it) and the host has already checked the caller is an active member of it; it can
only be `null` on a public endpoint called without the header, or in a handler for an event about no
organization. The actor's `memberships` only hold their membership in it. Restrict a route
with one of your own abilities, `@RequireAbility('read', 'Note')`. See `plugins/acme-notes` for a complete plugin.

### Abilities

`manifest.abilities` declares your CASL subjects (PascalCase) and what organization roles may do with them.
Grants are per organization only (there are no system-wide roles and no `system` grants): `organization`
grants (`member`, `org_admin`) apply only in the organization the user holds the role in. A user who is a
`member` of one organization and `org_admin` of another gets each role's actions only where they hold it. Org
admins are members too, so they also get the `member` grants (`ORGANIZATION_ROLE_INCLUDES`). Nobody holds every
ability, so a subject without grants (`{}`) is usable by nobody. The host turns the grants into the user's CASL rules
(`<namespace>:<Subject>`, with `{ organizationId }` conditions). `@RequireAbility` checks them in the request's
tenant, and the SPA uses them to show your pages and menus. The roles are
`OrganizationRoles`; a new organization role is a minor release.

### Everything is per organization

A plugin only ever reaches the **current organization** (`PluginContext.tenant()`): the request's `X-Tenant`,
or in an event handler the event's organization (`event.organizationId`). That holds whoever acts, with or
without a user.

- `DataProxy` creates records in it and only finds, counts, updates and removes its records
  (`organizationId: null` ones without one).
- `UsersProxy` only reaches its active members. Without one: the acting user, or the user a core event is
  about.
- A plugin can't choose or read another organization, and an emitted payload can't name one. There's no
  organizations proxy: `tenant()` is the only organization it sees.

### Turned on per organization, with lifecycle hooks

A module is off in an organization until its org admins turn it on. Declare `manifest.lifecycle` and
register hooks with `ModuleLifecycleProxy` to act on the change:

```ts
this.lifecycle.onEnabled(async (event) => { /* scaffold; catch up since event.lastDisabledAt */ });
this.lifecycle.onDisabled(async (event) => { /* light cleanup; never delete the org's data */ });
this.lifecycle.onDataRemoved(async (event) => { /* before the host deletes all your records in the org */ });
this.lifecycle.onUpgraded(async (event) => { /* migrate from event.lastPluginVersion; the module stays on */ });
```

Hooks run in that organization without an acting user, are retried until they succeed (so make them
idempotent), and a module with `onEnabled` is only on once it has succeeded. Test them with
`harness.lifecycle.enable(orgId)`, `disable(orgId)`, `removeData(orgId)` and `upgrade(orgId, { lastPluginVersion })`.

### Calls between modules

A module never imports another module's package or reads its collections. It calls the operations the other
module **exports**, through the host. The provider declares and implements them:

```ts
// acme.notes: manifest
exports: {
  'notes.list': { ability: { action: 'read', subject: 'Note' }, consumers: '*' },  // any approved module
  'notes.create': { ability: { action: 'create', subject: 'Note' }, consumers: ['acme.tasks'] },
},

// acme.notes: a class provider
@ExportedOperation('notes.list')
async list(input: { limit?: number } | null, call: PluginCallInfo): Promise<NoteSummary[]> { … }
```

The caller declares what it calls, and the core team approves each connection in its registry entry
(`approvedCalls`):

```ts
// acme.tasks: manifest
calls: { 'acme.notes': { operations: ['notes.list', 'notes.create'] } },

// acme.tasks: any provider
constructor(private readonly modules: ModuleCallsProxy) {}
const notes = await this.modules.call<NoteSummary[]>('acme.notes', 'notes.list', { limit: 5 });
```

A call runs in the provider (its proxies, permissions, data and quotas) for the same acting user, in the same
organization; the host checks the export's `ability` for that user and that the provider is on in the
organization. Only plain JSON crosses (at most `MAX_CALL_PAYLOAD_BYTES`), copied both ways, so validate the
input in the operation (no `ValidationPipe` runs) and return ISO strings, not dates. SDK errors reach the caller
as they are; anything else becomes `PluginCallFailedError`. Calls need an acting user (not in public endpoints,
event handlers or lifecycle hooks), can't call back into a module already in the chain, go at most
`MAX_CALL_DEPTH` deep and count against the provider's `callsPerMinute`. **Dependencies are soft:** handle
`PluginCallUnavailableError` (the module isn't installed or isn't turned on in this organization). Declare the
shape of the results yourself: you can't import the provider's types.

### Scheduled jobs

The API runs as many instances, so plugins don't use timers or cron libraries. Declare jobs (and, optionally,
recurring schedules) in the manifest, handle each with a `@JobHandler()` method, and schedule runs with
`JobsProxy`. The host keeps them in its database and runs each on exactly one instance when it's due:

```ts
// manifest: jobs: { 'round-end': { timeoutMs: 10_000 } },
//           schedules: { nightly: { cron: '0 3 * * *', job: 'cleanup', scope: 'organization' } }
@JobHandler('round-end')
async roundEnd(job: PluginJob<{ assemblyId: string }>) { /* idempotent: runs at least once */ }

await this.jobs.schedule('round-end', { runAt: endsAt, payload: { assemblyId }, key: `round-end:${assemblyId}` });
```

Jobs run without an acting user in the organization they were scheduled in, only while the module is on there,
within a second or two of `runAt`, and are retried (5 s, 10 s, 20 s…) up to `maxAttempts`. The core team approves
each job (`approvedJobs`) and each schedule with its cron expression (`approvedSchedules`). Test them with
`harness.jobs.runDue(at)`.

## A UI in 30 seconds

```ts
// src/ui/plugin.ts
import { createPluginUi } from '@unifyamerica/demleague-plugin-sdk/vue';
import { ACME_NOTES_MANIFEST } from '../manifest';   // the manifest imports from '@unifyamerica/demleague-plugin-sdk/manifest'

export const notesUi = createPluginUi(ACME_NOTES_MANIFEST);
export const { useApi, useI18n, useAbility } = notesUi;

// src/ui/index.ts, the package's `./ui` entry
export default notesUi.define({
  routes: [
    { path: '', name: 'list', component: () => import('./pages/NotesPage.vue'),
      ability: { action: 'read', subject: 'Note' }, titleKey: 'pages.notes.title' },
  ],
  mainMenu: [{ labelKey: 'nav.notes', icon: 'pi pi-book', to: 'list' }],
  i18n: { en },
});
```

The SPA bundles it at build time and mounts the pages under `/apps/<vendor>/<module>`. Each page only opens
for users holding its ability in the current organization, and its menu entries follow the same rule. A menu
entry can also be a group of links, for sub-navigation: `{ labelKey, icon, children: [{ labelKey, to }, …] }`
(one level).
`createPluginUi(manifest)` gives you everything the platform offers your UI, bound to your namespace:

- `useApi()`: your endpoints, sent in the current organization (`X-Tenant`)
- `useCurrentUser()`, `useCurrentOrganization()`
- `useAbility().can()`, on your subjects in the current organization
- `useI18n().t()`, your messages
- `useRouter()`, your routes by name
- `useToast()`, `useConfirm()`
- `defineStore()`, Pinia setup stores with namespaced ids

`/vue` also exports `vSafeHtml` (the `v-safe-html` directive) and `sanitizeHtml()`, to show HTML such as an
org admin's text after DOMPurify removes scripts, event handlers, frames, forms and styles. Both entries pass
[luxon](https://moment.github.io/luxon/) through (`DateTime`, `Duration`, `Interval`, `Info`, the zones; not
the global `Settings`), so plugins don't need a date package of their own.

`define()` throws if the UI doesn't match the manifest: an ability on an undeclared subject, or a menu
without its slot in `manifest.ui.slots`. A UI may only import `@unifyamerica/demleague-plugin-sdk/vue`, `vue`, `primevue`
and `primeicons`, its own files and the manifest. It may not include, create or inject iframes (nor
`frame`, `object`, `embed`) or write unsanitized HTML (`v-html`, `innerHTML`; use `v-safe-html`): lint and
the install PR's check reject them, and the SPA's CSP (`frame-src 'none'`) blocks frames. Style it with Tailwind utility classes. Build it with Vite in
library mode, keeping those packages external (see `plugins/acme-notes/vite.config.mts`).

## Rules the host enforces

| Rule | Where |
| --- | --- |
| Manifest is valid (namespace, semver, permissions, endpoints, events, limits) | `@PluginModule()` at class definition, and again at startup |
| Namespace is registered to your package; permissions, public endpoints, ability grants, UI slots and calls to other modules (`approvedCalls`) are approved | Startup (`namespace-registry.json`) |
| Every exported operation has exactly one `@ExportedOperation()` method on a class provider, and every such method is exported; each call is exported to you by the provider (a provider that isn't loaded is only a warning) | Startup |
| `@RequireAbility()` names a platform subject or one declared in `manifest.abilities` | Startup |
| Every controller route is declared in `endpoints`, and every declared endpoint exists | Startup |
| You only inject SDK services and your own providers (no core services, DB connection, `ModuleRef`) | Startup |
| No `imports`, no `@Global()`, no `APP_GUARD`/`APP_INTERCEPTOR`/`APP_FILTER`/`APP_PIPE` providers | `@PluginModule()` / startup |
| `@unifyamerica/demleague-plugin-sdk`, `@nestjs/*`, `class-validator`, `class-transformer` are **peerDependencies** | Startup (a second SDK copy is refused). A second `class-validator` copy would silently skip validation. |
| Endpoints need a valid user token unless `auth: 'public'` | Every request |
| Proxy calls need the matching permission. On a user's request, they're also limited to what that user may do. | Every call |
| Data is per organization: a user's request only reaches its tenant's records | Every call |
| Data is only in your declared collections. Filters use a safe subset (`$eq $ne $in $nin $gt $gte $lt $lte $exists $and $or`). Documents can't have `$`/dotted keys. | Every call |
| Events: only declared names; payloads are plain JSON, at most 32 KB, and frozen for subscribers | Every call |
| Module calls: only declared ones, with an acting user and a tenant, the provider on in the tenant, the export's ability for that user; plain JSON, at most 256 KB each way, copied | Every call |
| Jobs and schedules match the `@JobHandler()` methods and are approved (each schedule with its cron expression) | Startup |
| Jobs: only declared ones; plain JSON payloads, at most 32 KB; one pending job per key and organization; run only while the module is on in their organization | Every call / run |

### Limits

| Limit | Enforcement |
| --- | --- |
| `requestsPerMinute`, `dbOperationsPerMinute` | Hard, for the whole plugin: 429 `PLUGIN_QUOTA_EXCEEDED` |
| `requestsPerMinutePerUser` | Hard, per authenticated user: 429 `PLUGIN_QUOTA_EXCEEDED`. Public endpoints only count towards `requestsPerMinute`. |
| `maxDocumentBytes` | Hard: 413 |
| `maxDocuments`, `maxStorageBytes` | Hard, for your live documents across all your collections: 507 `PLUGIN_STORAGE_QUOTA_EXCEEDED`. Removing documents frees space. |
| `requestTimeoutMs` | The response fails with 503. Your handler can't be cancelled and keeps running. |
| `eventHandlerTimeoutMs` | Logged and counted as a handler error |
| `callsPerMinute` | Hard, on calls other modules make to your exported operations: 429 `PLUGIN_QUOTA_EXCEEDED` for the caller. A call is also bounded by your `requestTimeoutMs` (`PLUGIN_CALL_FAILED` for the caller). |
| `maxMemoryMb` | Advisory only (plugins share the API process) |
| `jobsPerMinute`, `maxPendingJobs` | Hard, on `JobsProxy.schedule()`: 429 `PLUGIN_QUOTA_EXCEEDED` |
| `jobTimeoutMs` | A run that takes longer counts as failed and is retried; its code keeps running |
| `maxConcurrentJobs` | How many of your jobs one API instance runs at once |

Sizes are the JSON of your own fields, not the ones the host adds (`id`, timestamps, `createdBy`).

Your limits can only lower what you get. Each one is capped by the registry's ceiling for your namespace, or
by the default in `DEFAULT_RESOURCE_LIMITS` when there's none: ask the core team to raise a ceiling if you need
more. The host warns at startup about declared limits above the approved ones.

### Events

Core events (`CoreEvents`) only carry ids, such as `{ userId }`. Fetch the record through a proxy, so your
permissions apply. Handlers run asynchronously **without an acting user**, so only your plugin's
permissions apply there. A failing handler never affects the emitter. Events are in-memory: don't rely on
them for anything that must not be lost.

## Testing

Unit tests are required with every submission. Use the harness: it wires your plugin the way the host does,
using in-memory proxies that enforce the same manifest rules.

```ts
import { createPluginTestHarness } from '@unifyamerica/demleague-plugin-sdk/testing';

const harness = await createPluginTestHarness(AcmeNotesPlugin, {
  actor: { id: 'u1', memberships: [{ organizationId: 'o1', roles: ['member'] }] },  // null = public endpoint / event handler; actor() only keeps the tenant's membership
  tenant: { id: 'o1', name: 'Org', slug: 'org', description: null },  // the X-Tenant; setTenant() to switch
  users: [/* PluginUser fixtures */],
  permissions: ['data:read'],                              // optional: override to test denials
});
harness.module.get(NotesService);                          // your providers
harness.events.deliver('core.organization.member-added', { userId: 'u1', organizationId: 'o1' });  // simulate an event
await harness.lifecycle.enable('o1');                     // run your onEnabled hook in o1
harness.events.emitted; harness.data.store; harness.data.usage; harness.logger.messages;

// Calls between modules
harness.calls.stub('acme.notes', 'notes.list', (input, { actor, tenant }) => [/* … */]);  // other modules are stubs
harness.calls.calls;                                       // what your code called; no stub = PluginCallUnavailableError
await harness.invokeExport('notes.list', { limit: 5 }, { caller: 'acme.tasks' });  // run your own export like the host
```

The harness enforces your declared storage limits and the per-organization isolation of data, users and
organizations (`deliver()` runs handlers in the event's organization). For module calls, it refuses
undeclared calls and calls without an actor and tenant, and copies input and results as plain JSON;
`invokeExport()` also checks the export's consumers and the actor's ability from your manifest's grants. It doesn't
reproduce the acting user's own platform permissions, the rate limits, the registry's ceilings and approvals,
or the provider's own rules behind a stub. The host adds those.

UI tests (Vitest, jsdom) use a fake host:

```ts
import { installTestPluginHost, uninstallTestPluginHost } from '@unifyamerica/demleague-plugin-sdk/vue/testing';

const host = installTestPluginHost({
  organization: { id: 'o1', name: 'Acme', slug: 'acme', description: null },
  abilities: ['read Note'],                     // default: everything
  responses: { 'GET /notes': { items: [], total: 0, limit: 100, skip: 0 } },
});
// mount(...) with Pinia & PrimeVue, then: host.requests, host.toasts, host.navigations; t() returns the key
```

## Versioning

The SDK follows semver independently of the API. `SDK_API_VERSION` is bumped only on a breaking change, and
the host refuses plugins built against another API version.

- **Patch:** bug fixes and better error messages.
- **Minor:** new proxy methods, new core events, new optional manifest fields, new platform roles, new UI
  slots or composables. Plugins declare the SDK peer as `">=<the minor they need> <1.0.0"`, so a minor
  doesn't force every plugin to release again.
- **Major:** removed or renamed proxy methods, changed DTO shapes, or new required manifest fields. Ship it
  with a migration guide and a deprecation window.

Anything exported from `src/index.ts` is part of the contract.

## Publishing

`npm run build` clears `dist/`, then builds CommonJS to `dist/` and the browser entries as ES modules to
`dist/esm/`.

Releases go to GitHub Packages (`publishConfig.registry`) only through `.github/workflows/release.yml`: bump
`version`, then push a `v<version>` tag. Its first job lints, type-checks, tests, builds and packs with
read-only access; the second attests the tarball (SLSA build provenance) and runs
`npm publish --ignore-scripts`. DemLeagueOS then pins the new version exactly, and its contract check
verifies the attestation. Verify a release yourself with
`gh attestation verify <tarball> --repo unifyamerica/demleague-plugin-sdk`.

To try an unreleased change in DemLeagueOS (or in a plugin), run `npm pack` here and install the tarball
there; bump the exact pin once the release is out. Avoid `npm link`: the linked clone resolves its peers
(`@nestjs/common`, `class-validator`, Vue) from its own `node_modules`, so the host would see a second copy of
them.
