import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { PLUGIN_ACTOR_REQUEST_KEY } from '../constants';
import { PluginActor } from '../types/dto';

/** The user making the request (`null` on a public endpoint), e.g. `list(@CurrentActor() actor: PluginActor)`. */
export const CurrentActor = createParamDecorator(
  (_data: unknown, context: ExecutionContext): PluginActor | null => {
    const request = context
      .switchToHttp()
      .getRequest<Record<string, unknown>>();
    return (
      (request[PLUGIN_ACTOR_REQUEST_KEY] as PluginActor | undefined) ?? null
    );
  },
);
