import { PluginPage, PluginUser, PluginUserProfileUpdate } from '../types/dto';

// A page of `findMembers()`: `limit` defaults to 25 and is at most 100 (MAX_QUERY_LIMIT)
export interface PluginMembersQuery {
  limit?: number;
  skip?: number;
}

/**
 * User operations a plugin may perform. Inject it like any provider: `constructor(private users: UsersProxy)`.
 * Requires `users:read` (reads) / `users:write` (updates). On a user's request, the acting user's own
 * permissions apply too, so a plugin can never do more on someone's behalf than they could themselves.
 *
 * Confined to the current organization (`PluginContext.tenant()`): only its active members are found (or
 * updated), and their `memberships` only list that organization. Without a current organization, only the
 * acting user, or in an event handler the user a core event is about (`payload.userId`).
 */
export abstract class UsersProxy {
  abstract findById(id: string): Promise<PluginUser | null>;
  abstract findByIds(ids: string[]): Promise<PluginUser[]>;
  // The current organization's active members, in a stable order (by id); without one, see above
  abstract findMembers(
    query?: PluginMembersQuery,
  ): Promise<PluginPage<PluginUser>>;
  abstract updateProfile(
    id: string,
    changes: PluginUserProfileUpdate,
  ): Promise<PluginUser>;
}
