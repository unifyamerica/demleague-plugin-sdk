import { PluginActor, PluginOrganization } from '../types/dto';
import { PluginManifest } from '../types/manifest';

/** Who the plugin is (set by the host, a plugin can't choose its namespace) and who it's acting for. */
export abstract class PluginContext {
  abstract readonly namespace: string;
  abstract readonly manifest: Readonly<PluginManifest>;
  // The acting user of the current request, null on public endpoints and in event handlers
  abstract actor(): PluginActor | null;
  // The organization the plugin's code currently works in: the request's `X-Tenant` organization, or in an
  // event handler the event's organization (`event.organizationId`); null without one. On authenticated
  // endpoints the host has already checked the actor may act in it. Data, users and organizations are
  // confined to it (see the proxies).
  abstract tenant(): PluginOrganization | null;
}
