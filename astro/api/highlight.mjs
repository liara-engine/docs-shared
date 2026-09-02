/**
 * Liara Engine — syntax highlighting for generated API pages.
 *
 * Expressive Code, which Starlight uses for code fences, only sees fences
 * written in Markdown. Generated pages emit HTML directly, so their
 * signatures would arrive as unstyled `<pre>` — the one place on the site
 * where code did not look like code.
 *
 * Shiki, already present in Astro's dependency tree, fills the gap. The
 * theme below is not one of Shiki's: it assigns CSS custom properties as
 * colours, so the `--liara-code-*` tokens drive the highlighting directly.
 * That has two consequences worth the trouble. Light and dark switching is
 * free, because the tokens already switch on `[data-theme]` and no second
 * theme has to be generated or kept in step. And the code palette Liara
 * already defines — nine roles, from keyword to preprocessor — stays in
 * use instead of being orphaned by the move away from mdBook and Doxygen,
 * which were until now its only consumers.
 */

/** Shiki theme whose colours are token references rather than literals. */
export const LIARA_SHIKI_THEME = {
    name: 'liara-tokens',
    type: 'light',
    colors: {
        'editor.foreground': 'var(--liara-code-text)',
        'editor.background': 'transparent',
    },
    settings: [
        { scope: ['comment', 'punctuation.definition.comment'],
          settings: { foreground: 'var(--liara-code-comment)' } },
        { scope: ['keyword', 'storage.type', 'storage.modifier', 'keyword.control'],
          settings: { foreground: 'var(--liara-code-keyword)' } },
        { scope: ['entity.name.type', 'support.type', 'entity.name.class', 'meta.struct'],
          settings: { foreground: 'var(--liara-code-type)' } },
        { scope: ['string', 'string.quoted', 'punctuation.definition.string'],
          settings: { foreground: 'var(--liara-code-string)' } },
        { scope: ['constant.numeric'],
          settings: { foreground: 'var(--liara-code-number)' } },
        { scope: ['entity.name.function', 'support.function', 'meta.function-call'],
          settings: { foreground: 'var(--liara-code-function)' } },
        { scope: ['keyword.operator', 'punctuation.separator', 'punctuation.terminator'],
          settings: { foreground: 'var(--liara-code-operator)' } },
        { scope: ['meta.preprocessor', 'keyword.control.directive', 'entity.name.function.preprocessor'],
          settings: { foreground: 'var(--liara-code-preprocessor)' } },
        { scope: ['constant.language', 'variable.other.constant', 'constant.other'],
          settings: { foreground: 'var(--liara-code-constant)' } },
    ],
};

/** Languages the generator may be asked to highlight. */
const LANGUAGES = ['c', 'cpp'];

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * Builds a highlighter for generated code blocks.
 *
 * Shiki is loaded lazily and its absence is not fatal: an unhighlighted
 * signature is a cosmetic loss, and failing a documentation build over a
 * transitive dependency of the build tool would be out of proportion. The
 * fallback produces the same markup, minus the colour.
 *
 * @param {string} [language='c'] Default language for blocks that omit one.
 * @returns {Promise<(code: string, language?: string) => string>}
 */
export async function createHighlight(language = 'c') {
    let highlighter = null;

    try {
        const { createHighlighter } = await import('shiki');
        highlighter = await createHighlighter({
            themes: [LIARA_SHIKI_THEME],
            langs: LANGUAGES,
        });
    } catch {
        highlighter = null;
    }

    return (code, lang = language) => {
        const source = String(code).trimEnd();
        if (!highlighter) {
            return `<pre class="lapi-code"><code>${escapeHtml(source)}</code></pre>`;
        }
        try {
            return highlighter.codeToHtml(source, {
                lang: LANGUAGES.includes(lang) ? lang : 'c',
                theme: LIARA_SHIKI_THEME.name,
            });
        } catch {
            return `<pre class="lapi-code"><code>${escapeHtml(source)}</code></pre>`;
        }
    };
}

/** Highlighter used when none is supplied: escapes, never colours. */
export function plainHighlight(code) {
    return `<pre class="lapi-code"><code>${escapeHtml(String(code).trimEnd())}</code></pre>`;
}
