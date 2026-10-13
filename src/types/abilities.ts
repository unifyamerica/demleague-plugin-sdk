// What a plugin lets users do with its own data, as CASL abilities. The plugin declares its subjects and which
// organization roles get which actions on them; the core team approves the grants in the namespace registry; the
// host turns them into the user's CASL rules, so the API (`@RequireAbility`) and the SPA (pages and menus)
// check the same thing.

export const PluginAbilityActions = {
  MANAGE: 'manage',
  CREATE: 'create',
  READ: 'read',
  UPDATE: 'update',
  DELETE: 'delete',
} as const;
export type PluginAbilityAction =
  (typeof PluginAbilityActions)[keyof typeof PluginAbilityActions];

// ℹ️ Mirrors the platform's organization roles. A new role is an additive (minor) SDK release; the host refuses
// grants to roles it doesn't know. The org-facing platform is strictly tenant-scoped: there are no system-wide
// roles, so a user's access comes only from their active membership in the current organization.

// Roles a user holds in one organization. Grants to them only apply in that organization.
export const OrganizationRoles = {
  ORG_ADMIN: 'org_admin',
  MEMBER: 'member',
} as const;
export type OrganizationRole =
  (typeof OrganizationRoles)[keyof typeof OrganizationRoles];

// The organization roles a role includes: an org admin is also a member, so grants to `member` apply to org
// admins as well, and `org_admin` grants only need what admins get on top
export const ORGANIZATION_ROLE_INCLUDES: Record<
  OrganizationRole,
  readonly OrganizationRole[]
> = {
  org_admin: ['member'],
  member: [],
};

/** The roles a membership's roles amount to, with the ones they include, e.g. `['org_admin', 'member']`. */
export const effectiveOrganizationRoles = (
  roles: readonly string[],
): string[] => [
  ...new Set(
    roles.flatMap((role) => [
      role,
      ...(ORGANIZATION_ROLE_INCLUDES[role as OrganizationRole] ?? []),
    ]),
  ),
];

export const GRANTABLE_ORGANIZATION_ROLES: OrganizationRole[] =
  Object.values(OrganizationRoles);

// Grants are per organization only.
export interface PluginAbilityGrants {
  // Only in the organizations where the user holds the role, e.g. `{ member: ['read'], org_admin: ['manage'] }`.
  // Org admins also get the `member` grants (`ORGANIZATION_ROLE_INCLUDES`).
  organization?: Partial<Record<OrganizationRole, PluginAbilityAction[]>>;
}

// Subject (PascalCase, e.g. `Note`) → grants. A subject with no grants (`{}`) can't be used by anyone in the
// org-facing API.
export type PluginAbilities = Record<string, PluginAbilityGrants>;

export const PLUGIN_SUBJECT_PATTERN = /^[A-Z][A-Za-z0-9]{0,40}$/;

// The platform's own subjects, which a plugin can't redeclare
export const CORE_SUBJECTS = ['all', 'User', 'Organization', 'Plugin'];

/** The subject as CASL rules name it: `<namespace>:<Subject>`, e.g. `acme.notes:Note`. */
export const pluginSubject = (namespace: string, subject: string): string =>
  `${namespace}:${subject}`;

/** Whether `action` is covered by the granted actions (`manage` covers every action). */
export const actionGranted = (
  granted: readonly string[] | undefined,
  action: string,
): boolean =>
  !!granted &&
  (granted.includes(action) || granted.includes(PluginAbilityActions.MANAGE));
