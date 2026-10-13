import { PluginQuery } from '../query/filter';
import { PluginPage, PluginRecord } from '../types/dto';

export interface PluginCollection<T extends object> {
  insert(document: T): Promise<PluginRecord<T>>;
  findById(id: string): Promise<PluginRecord<T> | null>;
  find(query?: PluginQuery): Promise<PluginPage<PluginRecord<T>>>;
  count(filter?: PluginQuery['filter']): Promise<number>;
  // Shallow merge of top-level fields, returns null when the record doesn't exist
  update(id: string, changes: Partial<T>): Promise<PluginRecord<T> | null>;
  // Soft delete, returns false when the record doesn't exist
  remove(id: string): Promise<boolean>;
}

/**
 * Storage in the plugin's own namespaced collections (declared in `manifest.collections`). Reads need
 * `data:read`, writes `data:write`. Every operation counts towards `limits.dbOperationsPerMinute`.
 *
 * Records are isolated by organization: each has an `organizationId`, set by the host to the current
 * organization (`PluginContext.tenant()`: the request's `X-Tenant`, or in an event handler the event's
 * organization). Every read, update and removal only sees that organization's records, with or without an
 * acting user; without a current organization, only records with `organizationId: null`. A plugin can never
 * choose another organization.
 */
export abstract class DataProxy {
  abstract collection<T extends object>(name: string): PluginCollection<T>;
}
