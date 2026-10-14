// The operations a plugin can be granted. A plugin declares the ones it needs in its manifest and the core
// team approves them in the namespace registry; the host enforces them in every service proxy call.
//
// Data access is always scoped to the plugin's own namespace (there is no "global" data permission), and
// user-facing calls are additionally limited by what the acting user may do.
export const PluginPermissions = {
  USERS_READ: 'users:read',
  USERS_READ_EMAIL: 'users:read:email',
  USERS_WRITE: 'users:write',
  DATA_READ: 'data:read',
  DATA_WRITE: 'data:write',
} as const;
export type PluginPermission =
  (typeof PluginPermissions)[keyof typeof PluginPermissions];

export const PLUGIN_PERMISSION_DESCRIPTIONS: Record<PluginPermission, string> =
  {
    'users:read':
      'Read user names, roles and memberships (no email unless users:read:email)',
    'users:read:email': 'Also read user email addresses (PII)',
    'users:write':
      'Update user profile fields (first name, last name, timezone)',
    'data:read': "Read the plugin's own namespaced collections",
    'data:write':
      "Create, update and delete in the plugin's own namespaced collections",
  };

export const isPluginPermission = (value: unknown): value is PluginPermission =>
  typeof value === 'string' &&
  (Object.values(PluginPermissions) as string[]).includes(value);
