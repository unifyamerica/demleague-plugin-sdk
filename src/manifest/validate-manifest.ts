import {
  CORE_SUBJECTS,
  GRANTABLE_ORGANIZATION_ROLES,
  PLUGIN_SUBJECT_PATTERN,
  PluginAbilities,
  PluginAbilityActions,
} from '../types/abilities';
import {
  ANY_CONSUMER,
  OPERATION_NAME_PATTERN,
  PluginCalls,
  PluginExports,
} from '../types/calls';
import { isCoreEvent } from '../types/events';
import {
  isCronExpression,
  isTimeZone,
  JOB_NAME_PATTERN,
  MAX_JOB_MAX_ATTEMPTS,
  ScheduleScopes,
} from '../types/jobs';
import { ModuleLifecycleHooks } from '../types/lifecycle';
import {
  DEFAULT_RESOURCE_LIMITS,
  EndpointAuth,
  HttpMethods,
  PluginManifest,
  PluginResourceLimits,
} from '../types/manifest';
import { isPluginPermission, PluginPermissions } from '../types/permissions';
import { isPluginUiSlot } from '../types/ui';

export const NAMESPACE_PATTERN = /^[a-z][a-z0-9-]{1,30}\.[a-z][a-z0-9-]{1,40}$/;
// Vendors reserved for the platform itself
export const RESERVED_VENDORS = ['core', 'plugins', 'auth', 'api', 'admin'];

const SEMVER_PATTERN = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;
const PATH_SEGMENT_PATTERN = /^(:[a-zA-Z][a-zA-Z0-9]*|[a-z0-9][a-z0-9-]*)$/;
const COLLECTION_PATTERN = /^[a-z][a-z0-9_]{0,40}$/;
const EVENT_SUFFIX_PATTERN = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/;
const PLUGIN_EVENT_PATTERN =
  /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/;

export function normalizeEndpointPath(path: string): string {
  const trimmed = `/${path}`.replace(/\/+/g, '/').replace(/\/$/, '');
  return trimmed === '' ? '/' : trimmed;
}

const findDuplicates = (values: string[]): string[] => [
  ...new Set(values.filter((value, i) => values.indexOf(value) !== i)),
];

function validateLifecycle(lifecycle: unknown, problems: string[]): void {
  if (lifecycle === undefined) {
    return;
  }
  if (
    lifecycle === null ||
    typeof lifecycle !== 'object' ||
    Array.isArray(lifecycle)
  ) {
    problems.push('lifecycle must be an object of hooks');
    return;
  }
  const known = Object.values(ModuleLifecycleHooks) as string[];
  for (const [hook, value] of Object.entries(lifecycle)) {
    if (!known.includes(hook)) {
      problems.push(`lifecycle.${hook} is not a known hook`);
    } else if (typeof value !== 'boolean') {
      problems.push(`lifecycle.${hook} must be true or false`);
    }
  }
}

function validateLimits(
  limits: PluginResourceLimits | undefined,
  problems: string[],
): void {
  if (limits === undefined) {
    return;
  }

  for (const [name, value] of Object.entries(limits)) {
    if (!(name in DEFAULT_RESOURCE_LIMITS)) {
      problems.push(`limits.${name} is not a known limit`);
    } else if (
      value !== undefined &&
      (!Number.isInteger(value) || value <= 0)
    ) {
      problems.push(`limits.${name} must be a positive integer`);
    }
  }
}

/**
 * Checks a manifest on its own (shape, naming and internal consistency). Whether its permissions are
 * approved is the host's job, against the namespace registry. Returns the problems found, empty when valid.
 */
export function validateManifest(manifest: PluginManifest): string[] {
  const problems: string[] = [];

  if (!manifest || typeof manifest !== 'object') {
    return ['manifest is required'];
  }

  const namespace = manifest.namespace;
  if (typeof namespace !== 'string' || !NAMESPACE_PATTERN.test(namespace)) {
    problems.push(
      `namespace "${namespace}" must look like "<vendor>.<module>" (lowercase letters, digits and dashes)`,
    );
  } else if (RESERVED_VENDORS.includes(namespace.split('.')[0])) {
    problems.push(`namespace vendor "${namespace.split('.')[0]}" is reserved`);
  }

  if (
    typeof manifest.version !== 'string' ||
    !SEMVER_PATTERN.test(manifest.version)
  ) {
    problems.push(`version "${manifest.version}" must be a semver version`);
  }

  if (
    typeof manifest.displayName !== 'string' ||
    !manifest.displayName.trim()
  ) {
    problems.push('displayName is required');
  }

  // 👉 Permissions
  const permissions = Array.isArray(manifest.permissions)
    ? manifest.permissions
    : [];
  if (!Array.isArray(manifest.permissions)) {
    problems.push('permissions must be an array');
  }
  for (const permission of permissions) {
    if (!isPluginPermission(permission)) {
      problems.push(`unknown permission "${permission}"`);
    }
  }
  for (const duplicate of findDuplicates(permissions)) {
    problems.push(`permission "${duplicate}" is declared more than once`);
  }
  if (
    permissions.includes(PluginPermissions.USERS_READ_EMAIL) &&
    !permissions.includes(PluginPermissions.USERS_READ)
  ) {
    problems.push('users:read:email requires users:read');
  }

  // 👉 Endpoints
  const endpoints = Array.isArray(manifest.endpoints) ? manifest.endpoints : [];
  if (!Array.isArray(manifest.endpoints)) {
    problems.push('endpoints must be an array (use [] for none)');
  }
  const endpointKeys: string[] = [];
  for (const endpoint of endpoints) {
    if (!(Object.values(HttpMethods) as string[]).includes(endpoint.method)) {
      problems.push(`endpoint method "${endpoint.method}" is not supported`);
    }
    if (typeof endpoint.path !== 'string' || !endpoint.path.startsWith('/')) {
      problems.push(`endpoint path "${endpoint.path}" must start with "/"`);
      continue;
    }
    const normalized = normalizeEndpointPath(endpoint.path);
    const segments = normalized.split('/').filter(Boolean);
    if (!segments.every((segment) => PATH_SEGMENT_PATTERN.test(segment))) {
      problems.push(
        `endpoint path "${endpoint.path}" may only contain kebab-case segments and :params`,
      );
    }
    if (
      endpoint.auth !== undefined &&
      !(Object.values(EndpointAuth) as string[]).includes(endpoint.auth)
    ) {
      problems.push(
        `endpoint auth "${endpoint.auth}" must be "user" or "public"`,
      );
    }
    endpointKeys.push(`${endpoint.method} ${normalized}`);
  }
  for (const duplicate of findDuplicates(endpointKeys)) {
    problems.push(`endpoint "${duplicate}" is declared more than once`);
  }

  // 👉 Collections
  const collections = manifest.collections ?? [];
  for (const collection of collections) {
    if (!COLLECTION_PATTERN.test(collection)) {
      problems.push(
        `collection "${collection}" must be snake_case (lowercase letters, digits and underscores)`,
      );
    }
  }
  for (const duplicate of findDuplicates(collections)) {
    problems.push(`collection "${duplicate}" is declared more than once`);
  }
  const usesData =
    permissions.includes(PluginPermissions.DATA_READ) ||
    permissions.includes(PluginPermissions.DATA_WRITE);
  if (usesData && collections.length === 0) {
    problems.push('data:read / data:write require at least one collection');
  }
  if (!usesData && collections.length > 0) {
    problems.push(
      'collections are declared but neither data:read nor data:write is',
    );
  }

  // 👉 Events
  for (const event of manifest.events?.emits ?? []) {
    const prefix = `${namespace}.`;
    if (
      !event.startsWith(prefix) ||
      !EVENT_SUFFIX_PATTERN.test(event.slice(prefix.length))
    ) {
      problems.push(
        `emitted event "${event}" must be "${prefix}<kebab-case-name>"`,
      );
    }
  }
  for (const event of manifest.events?.subscribes ?? []) {
    if (
      event.startsWith('core.')
        ? !isCoreEvent(event)
        : !PLUGIN_EVENT_PATTERN.test(event)
    ) {
      problems.push(
        `subscribed event "${event}" is not a core event or a "<vendor>.<module>.<event>" name`,
      );
    }
  }
  for (const duplicate of findDuplicates(manifest.events?.emits ?? [])) {
    problems.push(`emitted event "${duplicate}" is declared more than once`);
  }
  for (const duplicate of findDuplicates(manifest.events?.subscribes ?? [])) {
    problems.push(`subscribed event "${duplicate}" is declared more than once`);
  }

  validateLifecycle(manifest.lifecycle, problems);
  validateLimits(manifest.limits, problems);
  validateAbilities(manifest.abilities, problems);
  validateUi(manifest.ui, problems);
  validateExports(manifest, problems);
  validateCalls(manifest.calls, namespace, problems);
  validateJobs(manifest, problems);

  return problems;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const EXPORT_FIELDS = ['summary', 'ability', 'consumers'];

function validateExports(manifest: PluginManifest, problems: string[]): void {
  // ℹ️ Not `exports`: that's the CommonJS module object in the compiled code
  const declared: PluginExports | undefined = manifest.exports;
  if (declared === undefined) {
    return;
  }
  if (!isObject(declared)) {
    problems.push('exports must be an object of operation → declaration');
    return;
  }

  for (const [operation, declaration] of Object.entries(declared)) {
    const where = `exports["${operation}"]`;
    if (!OPERATION_NAME_PATTERN.test(operation)) {
      problems.push(
        `exported operation "${operation}" must be lowercase kebab-case segments separated by dots, e.g. "notes.list"`,
      );
    }
    if (!isObject(declaration)) {
      problems.push(`${where} must be an object`);
      continue;
    }
    Object.keys(declaration)
      .filter((field) => !EXPORT_FIELDS.includes(field))
      .forEach((field) =>
        problems.push(`${where}.${field} is not a known field`),
      );
    if (
      declaration.summary !== undefined &&
      typeof declaration.summary !== 'string'
    ) {
      problems.push(`${where}.summary must be a string`);
    }

    const { ability, consumers } = declaration;
    if (ability !== undefined) {
      if (!isObject(ability)) {
        problems.push(`${where}.ability must be { action, subject }`);
      } else {
        if (
          !(Object.values(PluginAbilityActions) as string[]).includes(
            ability.action,
          )
        ) {
          problems.push(
            `${where}.ability: unknown action "${String(ability.action)}"`,
          );
        }
        if (!Object.hasOwn(manifest.abilities ?? {}, ability.subject)) {
          problems.push(
            `${where}.ability: subject "${String(ability.subject)}" is not declared in abilities`,
          );
        }
      }
    }

    if (consumers === ANY_CONSUMER) {
      continue;
    }
    if (!Array.isArray(consumers) || consumers.length === 0) {
      problems.push(
        `${where}.consumers must be "${ANY_CONSUMER}" or a non-empty array of namespaces`,
      );
      continue;
    }
    for (const consumer of consumers) {
      if (typeof consumer !== 'string' || !NAMESPACE_PATTERN.test(consumer)) {
        problems.push(
          `${where}.consumers: "${String(consumer)}" is not a namespace`,
        );
      } else if (consumer === manifest.namespace) {
        problems.push(
          `${where}.consumers: a plugin can't export to itself ("${consumer}")`,
        );
      }
    }
    for (const duplicate of findDuplicates(consumers)) {
      problems.push(
        `${where}.consumers: "${duplicate}" is listed more than once`,
      );
    }
  }
}

function validateCalls(
  calls: PluginCalls | undefined,
  namespace: string,
  problems: string[],
): void {
  if (calls === undefined) {
    return;
  }
  if (!isObject(calls)) {
    problems.push('calls must be an object of namespace → { operations }');
    return;
  }

  for (const [provider, declaration] of Object.entries(calls)) {
    const where = `calls["${provider}"]`;
    if (!NAMESPACE_PATTERN.test(provider)) {
      problems.push(`${where}: "${provider}" is not a namespace`);
    } else if (provider === namespace) {
      problems.push(`${where}: a plugin can't call itself`);
    }
    const operations: unknown = isObject(declaration)
      ? declaration.operations
      : undefined;
    if (!Array.isArray(operations) || operations.length === 0) {
      problems.push(`${where}.operations must be a non-empty array`);
      continue;
    }
    for (const operation of operations) {
      if (
        typeof operation !== 'string' ||
        !OPERATION_NAME_PATTERN.test(operation)
      ) {
        problems.push(
          `${where}.operations: "${String(operation)}" is not an operation name`,
        );
      }
    }
    for (const duplicate of findDuplicates(operations as string[])) {
      problems.push(
        `${where}.operations: "${duplicate}" is listed more than once`,
      );
    }
  }
}

function validateActions(
  where: string,
  actions: unknown,
  problems: string[],
): void {
  if (!Array.isArray(actions)) {
    problems.push(`${where} must be an array of actions`);
    return;
  }
  const known = Object.values(PluginAbilityActions) as string[];
  for (const action of actions) {
    if (!known.includes(action as string)) {
      problems.push(`${where}: unknown action "${String(action)}"`);
    }
  }
  for (const duplicate of findDuplicates(actions as string[])) {
    problems.push(`${where}: action "${duplicate}" is listed more than once`);
  }
}

function validateAbilities(
  abilities: PluginAbilities | undefined,
  problems: string[],
): void {
  if (abilities === undefined) {
    return;
  }
  if (!abilities || typeof abilities !== 'object' || Array.isArray(abilities)) {
    problems.push('abilities must be an object of subject → grants');
    return;
  }

  for (const [subject, grants] of Object.entries(abilities)) {
    const where = `abilities.${subject}`;
    if (!PLUGIN_SUBJECT_PATTERN.test(subject)) {
      problems.push(
        `ability subject "${subject}" must be PascalCase, e.g. "Note"`,
      );
    } else if (CORE_SUBJECTS.includes(subject)) {
      problems.push(`ability subject "${subject}" is a platform subject`);
    }
    if (!grants || typeof grants !== 'object' || Array.isArray(grants)) {
      problems.push(`${where} must be an object ({} for no grants)`);
      continue;
    }

    for (const scope of Object.keys(grants)) {
      if (scope !== 'organization') {
        problems.push(
          `${where}.${scope}: only "organization" grants exist (grants are per organization)`,
        );
      }
    }
    for (const [role, actions] of Object.entries(grants.organization ?? {})) {
      if (!(GRANTABLE_ORGANIZATION_ROLES as string[]).includes(role)) {
        problems.push(
          `${where}.organization: unknown organization role "${role}"`,
        );
      }
      validateActions(`${where}.organization.${role}`, actions, problems);
    }
  }
}

/** Checks ability grants on their own (as in a manifest), e.g. the ones the namespace registry approves. */
export function validateAbilityGrants(abilities: PluginAbilities): string[] {
  const problems: string[] = [];
  validateAbilities(abilities, problems);
  return problems;
}

function validateUi(ui: PluginManifest['ui'], problems: string[]): void {
  if (ui === undefined) {
    return;
  }
  const slots = ui?.slots ?? [];
  if (!Array.isArray(slots)) {
    problems.push('ui.slots must be an array');
    return;
  }
  for (const slot of slots) {
    if (!isPluginUiSlot(slot)) {
      problems.push(`unknown UI slot "${String(slot)}"`);
    }
  }
  for (const duplicate of findDuplicates(slots)) {
    problems.push(`UI slot "${duplicate}" is declared more than once`);
  }
}

const JOB_FIELDS = ['summary', 'timeoutMs', 'maxAttempts'];
const SCHEDULE_FIELDS = ['summary', 'cron', 'timeZone', 'job', 'scope'];
const isPositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0;

function validateJobs(manifest: PluginManifest, problems: string[]): void {
  const { jobs, schedules } = manifest;
  if (jobs !== undefined) {
    if (!isObject(jobs)) {
      problems.push('jobs must be an object of job name → declaration');
    } else {
      for (const [name, declaration] of Object.entries(jobs)) {
        const where = `jobs["${name}"]`;
        if (!JOB_NAME_PATTERN.test(name)) {
          problems.push(
            `${where}: job names are lowercase kebab-case, e.g. "round-end"`,
          );
        }
        if (!isObject(declaration)) {
          problems.push(`${where} must be an object`);
          continue;
        }
        Object.keys(declaration)
          .filter((key) => !JOB_FIELDS.includes(key))
          .forEach((key) =>
            problems.push(`${where}.${key} is not a known field`),
          );
        if (
          declaration.summary !== undefined &&
          typeof declaration.summary !== 'string'
        ) {
          problems.push(`${where}.summary must be a string`);
        }
        if (
          declaration.timeoutMs !== undefined &&
          !isPositiveInteger(declaration.timeoutMs)
        ) {
          problems.push(`${where}.timeoutMs must be a positive integer`);
        }
        if (
          declaration.maxAttempts !== undefined &&
          (!isPositiveInteger(declaration.maxAttempts) ||
            declaration.maxAttempts > MAX_JOB_MAX_ATTEMPTS)
        ) {
          problems.push(
            `${where}.maxAttempts must be an integer from 1 to ${MAX_JOB_MAX_ATTEMPTS}`,
          );
        }
      }
    }
  }

  if (schedules === undefined) {
    return;
  }
  if (!isObject(schedules)) {
    problems.push('schedules must be an object of schedule name → declaration');
    return;
  }
  const declaredJobs = isObject(jobs) ? Object.keys(jobs) : [];
  const scopes: string[] = Object.values(ScheduleScopes);
  for (const [name, declaration] of Object.entries(schedules)) {
    const where = `schedules["${name}"]`;
    if (!JOB_NAME_PATTERN.test(name)) {
      problems.push(
        `${where}: schedule names are lowercase kebab-case, e.g. "nightly-cleanup"`,
      );
    }
    if (!isObject(declaration)) {
      problems.push(`${where} must be an object`);
      continue;
    }
    Object.keys(declaration)
      .filter((key) => !SCHEDULE_FIELDS.includes(key))
      .forEach((key) => problems.push(`${where}.${key} is not a known field`));
    if (
      declaration.summary !== undefined &&
      typeof declaration.summary !== 'string'
    ) {
      problems.push(`${where}.summary must be a string`);
    }
    if (!isCronExpression(declaration.cron)) {
      problems.push(
        `${where}.cron must be a five-field cron expression, e.g. "0 3 * * *"`,
      );
    }
    if (
      declaration.timeZone !== undefined &&
      !isTimeZone(declaration.timeZone)
    ) {
      problems.push(
        `${where}.timeZone must be an IANA time zone, e.g. "America/New_York"`,
      );
    }
    if (
      typeof declaration.job !== 'string' ||
      !declaredJobs.includes(declaration.job)
    ) {
      problems.push(`${where}.job must name a job declared in manifest.jobs`);
    }
    if (!scopes.includes(declaration.scope as string)) {
      problems.push(`${where}.scope must be one of ${scopes.join(', ')}`);
    }
  }
}
