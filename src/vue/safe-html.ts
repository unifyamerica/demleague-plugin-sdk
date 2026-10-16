/// <reference lib="dom" />
// ⬆️ The base tsconfig (Node, for the API entries) has no DOM types; this file only runs in the browser.
import DOMPurify, { type Config } from 'dompurify';
import type { ObjectDirective } from 'vue';

// What sanitized HTML may not contain, on top of what DOMPurify always removes (scripts, event handler
// attributes, `javascript:` URLs): anything that embeds or frames other content (the SPA's CSP blocks those
// anyway), forms and their controls (fake login prompts), styles (overlays dressed up as the SPA's own UI)
// and document-level elements.
const FORBIDDEN_TAGS = [
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'option',
  'style',
  'link',
  'meta',
  'base',
];

const CONFIG: Config = {
  FORBID_TAGS: FORBIDDEN_TAGS,
  FORBID_ATTR: ['style', 'srcdoc'],
  // Allowed because the hook below always adds rel="noopener noreferrer"
  ADD_ATTR: ['target'],
  ALLOW_DATA_ATTR: false,
};

let purifier: ReturnType<typeof DOMPurify> | null = null;

// Our own instance, so the hook below never changes how the host (or anything else) uses DOMPurify
function getPurifier(): ReturnType<typeof DOMPurify> {
  if (!purifier) {
    purifier = DOMPurify(window);
    // Links that open a new tab can't reach back into the SPA through `window.opener`
    purifier.addHook('afterSanitizeAttributes', (node) => {
      if (node.tagName === 'A' && node.getAttribute('target')) {
        node.setAttribute('rel', 'noopener noreferrer');
      }
    });
  }
  return purifier;
}

/**
 * Sanitizes HTML (for example written by an org admin) so it's safe to show in the SPA: no scripts, event
 * handlers, `javascript:` URLs, frames, forms or styles. Render it with the `v-safe-html` directive rather
 * than `v-html`, which stays forbidden.
 */
export function sanitizeHtml(html: string | null | undefined): string {
  if (!html) {
    return '';
  }
  return getPurifier().sanitize(html, CONFIG);
}

/**
 * `v-safe-html`: like `v-html`, but the value is always sanitized first (`sanitizeHtml`). Import it into a
 * `<script setup>` component to use it in the template:
 *
 * ```vue
 * <script setup lang="ts">
 * import { vSafeHtml } from '@unifyamerica/demleague-plugin-sdk/vue';
 * </script>
 * <template><div v-safe-html="question.prompt" /></template>
 * ```
 */
export const vSafeHtml: ObjectDirective<
  HTMLElement,
  string | null | undefined
> = {
  mounted(element, { value }) {
    element.innerHTML = sanitizeHtml(value);
  },
  updated(element, { value, oldValue }) {
    if (value !== oldValue) {
      element.innerHTML = sanitizeHtml(value);
    }
  },
};
