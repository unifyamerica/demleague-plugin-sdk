import {
  actionGranted,
  effectiveOrganizationRoles,
  OrganizationRoles,
} from './abilities';

describe('effectiveOrganizationRoles', () => {
  it('adds the roles an org admin includes', () => {
    expect(effectiveOrganizationRoles([OrganizationRoles.ORG_ADMIN])).toEqual([
      'org_admin',
      'member',
    ]);
  });

  it('keeps each role once, and unknown roles as they are', () => {
    expect(
      effectiveOrganizationRoles(['member', 'org_admin', 'guest']),
    ).toEqual(['member', 'org_admin', 'guest']);
  });
});

describe('actionGranted', () => {
  it('treats manage as every action', () => {
    expect(actionGranted(['manage'], 'delete')).toBe(true);
    expect(actionGranted(['read'], 'delete')).toBe(false);
    expect(actionGranted(undefined, 'read')).toBe(false);
  });
});
