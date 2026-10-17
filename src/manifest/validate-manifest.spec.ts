import { PluginManifest } from '../types/manifest';
import { normalizeEndpointPath, validateManifest } from './validate-manifest';

const validManifest = (
  overrides: Partial<PluginManifest> = {},
): PluginManifest => ({
  namespace: 'acme.notes',
  version: '1.0.0',
  displayName: 'Notes',
  permissions: ['users:read', 'data:read', 'data:write'],
  endpoints: [
    { method: 'GET', path: '/notes' },
    { method: 'GET', path: '/notes/:id' },
  ],
  collections: ['notes'],
  events: {
    emits: ['acme.notes.note-created'],
    subscribes: ['core.user.created', 'other.plugin.thing-happened'],
  },
  limits: { requestsPerMinute: 60 },
  ...overrides,
});

describe('validateManifest', () => {
  it('should accept a valid manifest', () => {
    expect(validateManifest(validManifest())).toEqual([]);
  });

  it('should ignore the deprecated sdkApiVersion', () => {
    expect(validateManifest(validManifest({ sdkApiVersion: 99 }))).toEqual([]);
  });

  it.each([
    'acme',
    'Acme.notes',
    'acme.notes.extra',
    'acme_corp.notes',
    '.notes',
  ])('should reject the malformed namespace %s', (namespace) => {
    expect(
      validateManifest(validManifest({ namespace, events: {} })),
    ).toContainEqual(expect.stringContaining('namespace'));
  });

  it('should reject a reserved vendor', () => {
    expect(
      validateManifest(validManifest({ namespace: 'core.notes', events: {} })),
    ).toContainEqual(expect.stringContaining('reserved'));
  });

  it('should reject unknown and duplicated permissions', () => {
    const problems = validateManifest(
      validManifest({
        permissions: [
          'users:read',
          'users:read',
          'users:delete' as any,
          'data:read',
        ],
      }),
    );

    expect(problems).toContainEqual(
      expect.stringContaining('unknown permission "users:delete"'),
    );
    expect(problems).toContainEqual(
      expect.stringContaining('"users:read" is declared more than once'),
    );
  });

  it('should require users:read for users:read:email', () => {
    expect(
      validateManifest(
        validManifest({ permissions: ['users:read:email', 'data:read'] }),
      ),
    ).toContainEqual('users:read:email requires users:read');
  });

  it('should reject malformed and duplicated endpoints', () => {
    const problems = validateManifest(
      validManifest({
        endpoints: [
          { method: 'GET', path: 'notes' },
          { method: 'GET', path: '/Notes_All' },
          { method: 'TRACE' as any, path: '/notes' },
          { method: 'GET', path: '/notes/' },
          { method: 'GET', path: '/notes' },
        ],
      }),
    );

    expect(problems).toContainEqual(
      expect.stringContaining('must start with "/"'),
    );
    expect(problems).toContainEqual(expect.stringContaining('kebab-case'));
    expect(problems).toContainEqual(
      expect.stringContaining('"TRACE" is not supported'),
    );
    expect(problems).toContainEqual(
      expect.stringContaining('"GET /notes" is declared more than once'),
    );
  });

  it('should require collections when data permissions are declared, and the other way round', () => {
    expect(validateManifest(validManifest({ collections: [] }))).toContainEqual(
      expect.stringContaining('require at least one collection'),
    );
    expect(
      validateManifest(
        validManifest({ permissions: ['users:read'], collections: ['notes'] }),
      ),
    ).toContainEqual(
      expect.stringContaining('neither data:read nor data:write'),
    );
  });

  it("should only allow emitting events in the plugin's own namespace", () => {
    expect(
      validateManifest(
        validManifest({
          events: { emits: ['core.user.created', 'acme.notes.'] },
        }),
      ),
    ).toEqual([
      expect.stringContaining(
        '"core.user.created" must be "acme.notes.<kebab-case-name>"',
      ),
      expect.stringContaining('"acme.notes." must be'),
    ]);
  });

  it('should reject unknown core events and malformed subscriptions', () => {
    expect(
      validateManifest(
        validManifest({
          events: { subscribes: ['core.user.deleted', 'nope'] },
        }),
      ),
    ).toHaveLength(2);
  });

  it('should reject non-positive limits', () => {
    expect(
      validateManifest(
        validManifest({
          limits: { requestsPerMinute: 0, requestTimeoutMs: 1.5 },
        }),
      ),
    ).toEqual([
      'limits.requestsPerMinute must be a positive integer',
      'limits.requestTimeoutMs must be a positive integer',
    ]);
  });

  it('should accept lifecycle hooks and reject unknown or malformed ones', () => {
    expect(
      validateManifest(
        validManifest({ lifecycle: { onEnabled: true, onDisabled: false } }),
      ),
    ).toEqual([]);
    expect(
      validateManifest(
        validManifest({
          lifecycle: { onInstalled: true, onEnabled: 'yes' } as any,
        }),
      ),
    ).toEqual([
      'lifecycle.onInstalled is not a known hook',
      'lifecycle.onEnabled must be true or false',
    ]);
    expect(validateManifest(validManifest({ lifecycle: [] as any }))).toEqual([
      'lifecycle must be an object of hooks',
    ]);
  });

  it('should reject unknown limits', () => {
    expect(
      validateManifest(
        validManifest({
          limits: { maxDocument: 10 } as PluginManifest['limits'],
        }),
      ),
    ).toEqual(['limits.maxDocument is not a known limit']);
  });

  it('should accept abilities and UI slots', () => {
    expect(
      validateManifest(
        validManifest({
          abilities: {
            Note: {
              organization: {
                member: ['read', 'create'],
                org_admin: ['manage'],
              },
            },
            Overview: {},
          },
          ui: { slots: ['main-menu', 'profile-menu'] },
        }),
      ),
    ).toEqual([]);
  });

  it('should reject invalid ability subjects, roles and actions', () => {
    expect(
      validateManifest(
        validManifest({
          abilities: {
            note: {},
            User: {},
            Note: {
              system: { staff: ['read'] },
              organization: {
                guest: ['read'],
                member: ['read', 'fly', 'read'],
              },
              everyone: {},
            } as never,
          },
        }),
      ),
    ).toEqual([
      'ability subject "note" must be PascalCase, e.g. "Note"',
      'ability subject "User" is a platform subject',
      'abilities.Note.system: only "organization" grants exist (grants are per organization)',
      'abilities.Note.everyone: only "organization" grants exist (grants are per organization)',
      'abilities.Note.organization: unknown organization role "guest"',
      'abilities.Note.organization.member: unknown action "fly"',
      'abilities.Note.organization.member: action "read" is listed more than once',
    ]);
  });

  it('should reject unknown and duplicate UI slots', () => {
    expect(
      validateManifest(
        validManifest({
          ui: { slots: ['main-menu', 'footer', 'main-menu'] as never },
        }),
      ),
    ).toEqual([
      'unknown UI slot "footer"',
      'UI slot "main-menu" is declared more than once',
    ]);
  });
});

describe('normalizeEndpointPath', () => {
  it.each([
    ['/notes/', '/notes'],
    ['//notes//:id', '/notes/:id'],
    ['/', '/'],
    ['', '/'],
  ])('should normalize %s to %s', (path, expected) => {
    expect(normalizeEndpointPath(path)).toBe(expected);
  });
});

describe('validateManifest: exports and calls', () => {
  const withAbilities = (overrides: Partial<PluginManifest>) =>
    validManifest({
      abilities: { Note: { organization: { member: ['read'] } } },
      ...overrides,
    });

  it('should accept exports and calls', () => {
    expect(
      validateManifest(
        withAbilities({
          exports: {
            'notes.list': {
              summary: 'List notes',
              ability: { action: 'read', subject: 'Note' },
              consumers: ['beta.crm'],
            },
            'notes.count': { consumers: '*' },
          },
          calls: { 'beta.crm': { operations: ['contacts.find'] } },
        }),
      ),
    ).toEqual([]);
  });

  it('should reject malformed exports', () => {
    expect(
      validateManifest(
        withAbilities({
          exports: {
            'Notes.List': { consumers: '*' },
            'notes.a': {
              ability: { action: 'fly' as never, subject: 'Task' },
              consumers: [],
            },
            'notes.b': {
              consumers: ['acme.notes', 'nope', 'beta.crm', 'beta.crm'],
            },
            'notes.c': { consumers: '*', allowSystem: true } as never,
          },
        }),
      ),
    ).toEqual([
      expect.stringContaining('exported operation "Notes.List" must be'),
      'exports["notes.a"].ability: unknown action "fly"',
      'exports["notes.a"].ability: subject "Task" is not declared in abilities',
      'exports["notes.a"].consumers must be "*" or a non-empty array of namespaces',
      `exports["notes.b"].consumers: a plugin can't export to itself ("acme.notes")`,
      'exports["notes.b"].consumers: "nope" is not a namespace',
      'exports["notes.b"].consumers: "beta.crm" is listed more than once',
      'exports["notes.c"].allowSystem is not a known field',
    ]);
  });

  it('should reject malformed calls', () => {
    expect(
      validateManifest(
        validManifest({
          calls: {
            'acme.notes': { operations: ['notes.list'] },
            nope: { operations: [] },
            'beta.crm': { operations: ['a.b', 'a.b', 'Bad'] },
          },
        }),
      ),
    ).toEqual([
      `calls["acme.notes"]: a plugin can't call itself`,
      'calls["nope"]: "nope" is not a namespace',
      'calls["nope"].operations must be a non-empty array',
      'calls["beta.crm"].operations: "Bad" is not an operation name',
      'calls["beta.crm"].operations: "a.b" is listed more than once',
    ]);
  });
});

describe('validateManifest: jobs and schedules', () => {
  it('should accept jobs and schedules', () => {
    expect(
      validateManifest(
        validManifest({
          jobs: {
            'round-end': {
              summary: 'Close a round',
              timeoutMs: 5000,
              maxAttempts: 5,
            },
            cleanup: {},
          },
          schedules: {
            'nightly-cleanup': {
              cron: '0 3 * * *',
              timeZone: 'America/New_York',
              job: 'cleanup',
              scope: 'organization',
            },
            weekly: {
              cron: '*/15 9-17 * JAN-DEC MON-FRI',
              job: 'cleanup',
              scope: 'global',
            },
          },
        }),
      ),
    ).toEqual([]);
  });

  it('should reject malformed jobs', () => {
    expect(
      validateManifest(
        validManifest({
          jobs: {
            RoundEnd: {},
            slow: { timeoutMs: 0, maxAttempts: 11, retries: 2 } as never,
          },
        }),
      ),
    ).toEqual([
      'jobs["RoundEnd"]: job names are lowercase kebab-case, e.g. "round-end"',
      'jobs["slow"].retries is not a known field',
      'jobs["slow"].timeoutMs must be a positive integer',
      'jobs["slow"].maxAttempts must be an integer from 1 to 10',
    ]);
  });

  it('should reject malformed schedules', () => {
    expect(
      validateManifest(
        validManifest({
          jobs: { cleanup: {} },
          schedules: {
            nightly: {
              cron: '0 3 * *',
              timeZone: 'Mars/Olympus',
              job: 'other',
              scope: 'tenant',
            } as never,
          },
        }),
      ),
    ).toEqual([
      'schedules["nightly"].cron must be a five-field cron expression, e.g. "0 3 * * *"',
      'schedules["nightly"].timeZone must be an IANA time zone, e.g. "America/New_York"',
      'schedules["nightly"].job must name a job declared in manifest.jobs',
      'schedules["nightly"].scope must be one of organization, global',
    ]);
  });

  it('should accept the job limits', () => {
    expect(
      validateManifest(
        validManifest({
          limits: {
            jobsPerMinute: 60,
            maxPendingJobs: 100,
            jobTimeoutMs: 5000,
            maxConcurrentJobs: 1,
          },
        }),
      ),
    ).toEqual([]);
  });
});
