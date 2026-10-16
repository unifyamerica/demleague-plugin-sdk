/**
 * @jest-environment jsdom
 */
import {
  createApp,
  defineComponent,
  h,
  nextTick,
  ref,
  withDirectives,
} from 'vue';
import { sanitizeHtml, vSafeHtml } from './safe-html';

describe('sanitizeHtml', () => {
  it('should keep formatting, links and images', () => {
    const html =
      '<h1>Welcome</h1><p>Read <strong>this</strong> <a href="https://example.org/a">first</a>.</p><img src="https://example.org/x.png" alt="x">';
    expect(sanitizeHtml(html)).toBe(html);
  });

  it('should return an empty string for nothing', () => {
    expect(sanitizeHtml(null)).toBe('');
    expect(sanitizeHtml(undefined)).toBe('');
    expect(sanitizeHtml('')).toBe('');
  });

  it('should remove scripts, event handlers and javascript: URLs', () => {
    const clean = sanitizeHtml(
      '<p onclick="steal()">Hi<script>steal()</script></p><a href="javascript:steal()">x</a><img src="x" onerror="steal()">',
    );
    expect(clean).not.toMatch(/script|onclick|onerror|javascript:/i);
    expect(clean).toContain('<p>Hi</p>');
  });

  it('should remove frames, embeds, forms and styles', () => {
    const clean = sanitizeHtml(
      '<iframe src="https://evil.example"></iframe><object data="x"></object><embed src="x">' +
        '<form action="https://evil.example"><input name="password"><button>Log in</button></form>' +
        '<style>body{display:none}</style><div style="position:fixed;inset:0">Overlay</div>',
    );
    expect(clean).not.toMatch(/iframe|object|embed|form|input|button|style/i);
    // Removed elements leave their text behind, which is harmless
    expect(clean).toBe('Log in<div>Overlay</div>');
  });

  it('should keep links that open a new tab from reaching window.opener', () => {
    expect(
      sanitizeHtml('<a href="https://example.org" target="_blank">x</a>'),
    ).toBe(
      '<a href="https://example.org" target="_blank" rel="noopener noreferrer">x</a>',
    );
  });
});

describe('vSafeHtml', () => {
  it('should render sanitized HTML and follow changes', async () => {
    const html = ref('<p>One<script>steal()</script></p>');
    const App = defineComponent({
      setup: () => () =>
        withDirectives(h('div', { id: 'target' }), [[vSafeHtml, html.value]]),
    });
    const root = document.createElement('div');
    const app = createApp(App);
    app.mount(root);

    expect(root.querySelector('#target')?.innerHTML).toBe('<p>One</p>');

    html.value = '<em>Two</em><img src="x" onerror="steal()">';
    await nextTick();
    expect(root.querySelector('#target')?.innerHTML).toBe(
      '<em>Two</em><img src="x">',
    );

    app.unmount();
  });
});
