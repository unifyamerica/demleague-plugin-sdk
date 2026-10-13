import { PluginOrganization } from '../types/dto';

/**
 * Organization reads, requires `organizations:read` (and, on a user's request, the user's own access). Only
 * the current organization (`PluginContext.tenant()`) is ever found; without one, none.
 */
export abstract class OrganizationsProxy {
  abstract findById(id: string): Promise<PluginOrganization | null>;
  abstract findByIds(ids: string[]): Promise<PluginOrganization[]>;
}
