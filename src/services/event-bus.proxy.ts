import { EventPayload, PluginEventHandler } from '../types/events';

/**
 * Loosely coupled communication with the platform and other plugins. Only events declared in
 * `manifest.events` can be emitted / subscribed to. Handlers run asynchronously, without an acting user,
 * and a failing handler never affects the emitter.
 */
export abstract class EventBusProxy {
  abstract emit<TName extends string>(
    name: TName,
    payload: EventPayload<TName>,
  ): void;
  abstract on<TName extends string>(
    name: TName,
    handler: PluginEventHandler<TName>,
  ): void;
}
