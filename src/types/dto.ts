// What plugins get back from the host. Always plain, copied objects: never database documents.

export interface PluginMembership {
  organizationId: string;
  roles: string[];
}

export interface PluginUser {
  id: string;
  firstName: string;
  lastName: string;
  // Only present when the plugin holds `users:read:email`
  email?: string;
  memberships: PluginMembership[];
}

export interface PluginUserProfileUpdate {
  firstName?: string;
  lastName?: string;
  timezone?: string | null;
}

export interface PluginOrganization {
  id: string;
  name: string;
  slug: string;
  description: string | null;
}

// The user a request is made by (`@PluginActor()` / `PluginContext.actor()`), `null` for public endpoints and
// event handlers
export interface PluginActor {
  id: string;
  // Only the actor's active membership in the current organization (tenant): at most one entry, empty when the
  // request has no tenant or the actor isn't a member of it
  memberships: PluginMembership[];
}

export type PluginRecord<T extends object> = T & {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  // The acting user's id, `null` when written from an event handler
  createdBy: string | null;
  // The organization the record belongs to (see `DataProxy`), `null` for none
  organizationId: string | null;
};

export interface PluginPage<T> {
  items: T[];
  total: number;
  limit: number;
  skip: number;
}
