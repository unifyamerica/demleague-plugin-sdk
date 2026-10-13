import { createPinia, setActivePinia } from 'pinia';
import { ref } from 'vue';
import { SDK_API_VERSION } from '../constants';
import { PluginManifest } from '../types/manifest';
import { createPluginUi } from './create-plugin-ui';
import { getPluginHost, installPluginHost } from './host';
import {
  installTestPluginHost,
  TestPluginHost,
  uninstallTestPluginHost,
} from './testing';

const manifest: PluginManifest = {
  sdkApiVersion: SDK_API_VERSION,
  namespace: 'acme.notes',
  version: '1.0.0',
  displayName: 'Notes',
  permissions: [],
  endpoints: [],
  abilities: { Note: { organization: { member: ['read'] } }, Overview: {} },
  ui: { slots: ['main-menu'] },
};

const Page = { render: () => null };

describe('createPluginUi', () => {
  const ui = createPluginUi(manifest);
  let host: TestPluginHost;

  beforeEach(() => {
    host = installTestPluginHost({
      responses: { 'GET /notes': { items: [] } },
      abilities: ['read Note'],
    });
  });

  afterEach(() => uninstallTestPluginHost());

  it('should define a valid UI with the namespace and manifest', () => {
    const definition = ui.define({
      routes: [
        {
          path: '',
          name: 'list',
          component: Page,
          ability: { action: 'read', subject: 'Note' },
          children: [{ path: ':id', name: 'detail', component: Page }],
        },
      ],
      mainMenu: [{ labelKey: 'nav.notes', icon: 'pi pi-book', to: 'list' }],
    });

    expect(definition.namespace).toBe('acme.notes');
    expect(definition.manifest).toBe(manifest);
    expect(Object.isFrozen(definition)).toBe(true);
  });

  it('should refuse routes and menus the manifest does not allow', () => {
    expect(() =>
      ui.define({
        routes: [
          { path: '', name: 'list', component: Page },
          {
            path: 'x',
            name: 'list',
            component: Page,
            ability: { action: 'read', subject: 'Secret' },
          },
          { path: 'y', name: 'Bad Name', component: Page },
        ],
        mainMenu: [{ labelKey: 'a', icon: 'pi', to: 'missing' }],
        profileMenu: [{ labelKey: 'b', icon: 'pi', to: 'list' }],
      }),
    ).toThrow(
      [
        'Invalid UI for plugin acme.notes:',
        '  - route "list" is declared more than once',
        `  - route "list" requires an ability on "Secret", which manifest.abilities doesn't declare`,
        '  - route "Bad Name" must be named in kebab-case',
        '  - main-menu item "a" targets unknown route "missing"',
        '  - menu items for "profile-menu" need it in manifest.ui.slots',
      ].join('\n'),
    );
  });

  it('should accept menu groups of links to its routes', () => {
    const definition = ui.define({
      routes: [
        { path: '', name: 'list', component: Page },
        { path: 'pinned', name: 'pinned', component: Page },
      ],
      mainMenu: [
        {
          labelKey: 'nav.notes',
          icon: 'pi pi-book',
          children: [
            { labelKey: 'nav.all', to: 'list' },
            { labelKey: 'nav.pinned', icon: 'pi pi-star', to: 'pinned' },
          ],
        },
      ],
    });

    expect(definition.mainMenu?.[0]?.children).toHaveLength(2);
  });

  it('should refuse malformed menu groups', () => {
    expect(() =>
      ui.define({
        routes: [{ path: '', name: 'list', component: Page }],
        mainMenu: [
          { labelKey: 'none', icon: 'pi' },
          {
            labelKey: 'both',
            icon: 'pi',
            to: 'list',
            children: [{ labelKey: 'c', to: 'list' }],
          },
          { labelKey: 'empty', icon: 'pi', children: [] },
          {
            labelKey: 'deep',
            icon: 'pi',
            children: [
              {
                labelKey: 'c',
                to: 'missing',
                children: [{ labelKey: 'd', to: 'list' }],
              } as never,
            ],
          },
        ],
      }),
    ).toThrow(
      [
        'Invalid UI for plugin acme.notes:',
        '  - main-menu item "none" needs a route (`to`) or `children`',
        `  - main-menu item "both" is a group (\`children\`), so it can't also link to a route`,
        '  - main-menu item "empty" needs at least one child',
        `  - main-menu item "deep": child "c" can't have children (one level only)`,
        '  - main-menu item "deep": child "c" targets unknown route "missing"',
      ].join('\n'),
    );
  });

  it('should reach the host with its own namespace', async () => {
    expect(await ui.useApi().get('/notes')).toEqual({ items: [] });
    expect(host.requests).toEqual([
      { method: 'GET', path: '/notes', body: undefined, params: undefined },
    ]);
    expect(ui.useAbility().can('read', 'Note')).toBe(true);
    expect(ui.useAbility().can('read', 'Overview')).toBe(false);
    expect(ui.useI18n().t('nav.notes')).toBe('nav.notes');

    await ui.useRouter().push({ name: 'detail', params: { id: '1' } });
    expect(host.navigations).toEqual([{ name: 'detail', params: { id: '1' } }]);

    ui.useToast().error(new Error('boom'));
    expect(host.toasts).toEqual([{ severity: 'error', detail: 'boom' }]);
    expect(await ui.useConfirm()('Sure?')).toBe(true);
  });

  it('should expose the current user and organization reactively', () => {
    const organization = ui.useCurrentOrganization();
    expect(organization.value).toBeNull();

    host.organization.value = {
      id: 'o1',
      name: 'Org',
      slug: 'org',
      description: null,
    };

    expect(organization.value?.slug).toBe('org');
    expect(ui.useCurrentUser().value).toBeNull();
  });

  it('should prefix store ids with the namespace', () => {
    setActivePinia(createPinia());
    const useCounter = ui.defineStore('counter', () => ({ count: ref(1) }));

    expect(useCounter.$id).toBe('acme.notes/counter');
    expect(useCounter().count).toBe(1);
  });

  it('should only let the host be installed once', () => {
    uninstallTestPluginHost();
    expect(() => getPluginHost()).toThrow('not installed');

    installPluginHost(host);
    expect(() => installPluginHost(host)).toThrow('already installed');
  });
});
