import { SetMetadata } from '@nestjs/common';
import { PLUGIN_REQUIRED_ABILITY_METADATA } from '../constants';

export type CoreAbilityAction =
  'manage' | 'create' | 'read' | 'update' | 'delete';
export type CoreAbilitySubject = 'User';
export const CORE_ABILITY_SUBJECTS: CoreAbilitySubject[] = ['User'];

export interface RequiredAbility {
  action: CoreAbilityAction;
  // A platform subject, or one of the plugin's own (declared in `manifest.abilities`)
  subject: string;
}

/**
 * Only lets users through who hold this ability, checked by the host. Either:
 * - a platform ability on `User` (type-level), e.g. `@RequireAbility('read', 'User')`
 * - one of the plugin's own subjects, e.g. `@RequireAbility('read', 'Note')`, checked in the organization the
 *   request acts in (its `X-Tenant`): a grant to `member` only lets members of that organization through.
 *   Without a tenant, only system-wide grants (and admins) pass.
 *
 * The host refuses to start a plugin whose subject is neither.
 */
export const RequireAbility = (
  action: CoreAbilityAction,
  subject: CoreAbilitySubject | (string & {}),
) =>
  SetMetadata(PLUGIN_REQUIRED_ABILITY_METADATA, {
    action,
    subject,
  } satisfies RequiredAbility);
