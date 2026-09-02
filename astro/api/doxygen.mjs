/**
 * Liara Engine — Doxygen XML to rendered HTML.
 *
 * Doxygen's XML is the input, and HTML is the output. Markdown and MDX are
 * deliberately not in between.
 *
 * MDX would be the obvious intermediate — write files, let Starlight pick
 * them up — but doc comments are full of `<`, `{` and `>` in type names,
 * template parameters and comparisons, and all three are syntax in MDX.
 * Escaping them correctly means escaping them everywhere, in every nested
 * description, forever, and one miss is a build failure on a page nobody
 * touched. Producing HTML directly and handing it to Astro's content layer
 * as pre-rendered output removes the entire class of problem: the only
 * escaping is the one this module performs, on text nodes, in one place.
 *
 * Doxygen's description markup is a small, closed vocabulary — para,
 * computeroutput, ref, simplesect, parameterlist and a few dozen more — so
 * the conversion is a recursive walk over known tags with a conservative
 * fallback for anything unrecognised.
 *
 * Two rules decide what happens to a documentation section:
 *
 *   *Lifted*   `@param`, `@retval`, `@exception`, `@tparam` and `@return`
 *              are structured data, not prose. They are pulled out of the
 *              description into the model and rendered by api/pages.mjs as
 *              tables, so the reader always finds them in the same place
 *              whatever order the author wrote them in.
 *
 *   *Labelled* Everything else that Doxygen calls a section — `@pre`,
 *              `@post`, `@since`, `@par`, `@deprecated`, `@todo`, and the
 *              variable lists that a project's own `ALIASES` expand into —
 *              stays where the author put it, but is rendered as a labelled
 *              block. Losing the label is what used to make a precondition
 *              read as an ordinary sentence.
 */

import { DOMParser } from '@xmldom/xmldom';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Block-level elements that may not appear inside a <p>. */
const BLOCK_LEVEL = /<(?:aside|table|pre|ul|ol|dl|div|details|h[1-6]|blockquote|hr)[\s>/]/;

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const CDATA_NODE = 4;

/** Member kinds worth a page section, in the order they should appear.
 *  Ordering is by what a reader looks for first, not by Doxygen's own.
 *  A kind Doxygen emits that is missing here still gets a section — it is
 *  appended after these, under its own name. */
export const MEMBER_ORDER = ['define', 'typedef', 'enum', 'function', 'variable'];

/** Section heading for a group of members. */
const MEMBER_LABELS = {
    define: 'Macros',
    typedef: 'Typedefs',
    enum: 'Enumerations',
    function: 'Functions',
    variable: 'Variables',
    friend: 'Friends',
    property: 'Properties',
    signal: 'Signals',
    slot: 'Slots',
    event: 'Events',
    service: 'Services',
    interface: 'Interfaces',
};

/** What one member of that kind is called, for the badge on its card. A
 *  badge says `function`, not `Functions`, because it labels one thing. */
const MEMBER_KIND_LABELS = {
    define: 'macro',
    typedef: 'typedef',
    enum: 'enum',
    function: 'function',
    variable: 'variable',
    friend: 'friend',
    property: 'property',
    signal: 'signal',
    slot: 'slot',
    event: 'event',
    service: 'service',
    interface: 'interface',
};

/** What one compound of that kind is called. */
const COMPOUND_KIND_LABELS = {
    file: 'header',
    struct: 'struct',
    union: 'union',
    class: 'class',
    namespace: 'namespace',
    interface: 'interface',
    concept: 'concept',
};

/* -------------------------------------------------------------- utilities */

export function escapeHtml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * Slug for a compound.
 *
 * A file keeps its extension, folded into the slug: `liara_version.h`
 * becomes `liara_version-h`. Stripping it looked tidier and was wrong —
 * a header and the struct it declares routinely share a base name, and
 * dropping the extension made them collide silently, one page quietly
 * replacing the other.
 */
export function compoundSlug(name) {
    return slugify(name);
}

/**
 * Turns a symbol name into a URL-safe slug.
 *
 * Doxygen's own identifiers (`liara__version_8h_1a8ac655b2...`) are stable
 * but unreadable and change whenever a signature does, so they are used for
 * cross-reference resolution only and never appear in a URL.
 */
export function slugify(name) {
    return String(name)
        .replace(/::/g, '-')
        .replace(/[^A-Za-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase();
}

/**
 * Whether Doxygen invented this name.
 *
 * An unnamed enum, struct or union has no name to print, so Doxygen makes
 * one up. For a member it is `@` followed by a long run of digits, unique
 * per compilation and meaningless; for a nested aggregate it is a
 * `[struct]` or `[union]` segment in the middle of a path,
 * `HardwareOverlay::[union].status`. Neither may reach a page or a URL, and
 * neither can collide with a real identifier: no C or C++ name contains
 * `@` or a bracket.
 */
export function isAnonymousName(name) {
    return /@\d+|\[(?:struct|union|enum|class|interface)\]/.test(String(name ?? ''));
}

/**
 * A readable name for an unnamed enum, derived from its enumerators.
 *
 * `LIARA_ABI_VERSION_MAJOR`, `…_MINOR` and `…_PATCH` share the prefix
 * `LIARA_ABI_VERSION_`, and `LIARA_ABI_VERSION_*` is what a reader would
 * call that group — it is also what they would search for. Without a usable
 * common prefix there is nothing honest to invent, so the group is simply
 * called anonymous.
 */
export function anonymousEnumLabel(values = []) {
    const names = values.map((value) => value.name).filter(Boolean);
    if (names.length < 2) return names.length === 1 ? `${names[0]}` : 'Anonymous enum';

    let prefix = names[0];
    for (const name of names.slice(1)) {
        let i = 0;
        while (i < prefix.length && i < name.length && prefix[i] === name[i]) i += 1;
        prefix = prefix.slice(0, i);
    }
    // Cut back to a separator so the label breaks where the name does, not
    // mid-word: `LIARA_ABI_VERSION_MA` is worse than no prefix at all.
    prefix = prefix.replace(/[^_]*$/, '');
    return prefix.length >= 3 ? `${prefix}*` : 'Anonymous enum';
}

function children(node) {
    return Array.from(node.childNodes ?? []);
}

function elements(node, tag) {
    return children(node).filter((c) => c.nodeType === ELEMENT_NODE && c.nodeName === tag);
}

function firstElement(node, tag) {
    return elements(node, tag)[0] ?? null;
}

function textOf(node) {
    if (!node) return '';
    if (node.nodeType === TEXT_NODE || node.nodeType === CDATA_NODE) return node.nodeValue ?? '';
    return children(node).map(textOf).join('');
}

function attr(node, name) {
    return node?.getAttribute?.(name) ?? '';
}

function isYes(node, name) {
    return attr(node, name) === 'yes';
}

/** Unwraps a lone `<p>` so a one-sentence description can sit inline. */
export function stripOuterParagraph(html) {
    const match = String(html).match(/^<p>([\s\S]*)<\/p>$/);
    return match && !match[1].includes('<p>') ? match[1] : html;
}

/* ------------------------------------------------------- description → HTML */

/**
 * Renders a Doxygen description subtree as HTML.
 *
 * @param {Node|null} node    The `briefdescription` or `detaileddescription`.
 * @param {object}    context `{ resolveRef, highlight }`. `resolveRef` maps a
 *                            Doxygen refid to a URL, or returns null to render
 *                            the reference as plain code; `highlight` renders a
 *                            code block, and falls back to a plain `<pre>`.
 * @returns {string} HTML, or an empty string when the node is absent or blank.
 */
export function renderDescription(node, context = {}) {
    if (!node) return '';
    return children(node).map((child) => renderNode(child, context)).join('').trim();
}

/**
 * Renders a node's children as inline HTML, keeping cross-references.
 *
 * Used for the places where Doxygen puts markup inside what looks like a
 * plain string — a parameter's `<type>` holds `<ref>` elements, so rendering
 * it as text would throw away every link in every signature.
 */
export function renderInline(node, context = {}) {
    if (!node) return '';
    return children(node).map((child) => renderNode(child, context)).join('').trim();
}

const HTML_PASSTHROUGH = {
    bold: 'strong',
    s: 's',
    strike: 's',
    del: 'del',
    ins: 'ins',
    underline: 'u',
    emphasis: 'em',
    superscript: 'sup',
    subscript: 'sub',
    small: 'small',
    blockquote: 'blockquote',
    center: 'div',
};

/** Markup whose content is meant for another output format entirely. */
const FOREIGN_OUTPUT = new Set([
    'latexonly', 'manonly', 'rtfonly', 'docbookonly', 'xmlonly',
    'dot', 'msc', 'plantuml', 'dotfile', 'mscfile', 'diafile',
]);

function renderNode(node, context) {
    if (node.nodeType === TEXT_NODE || node.nodeType === CDATA_NODE) {
        return escapeHtml(node.nodeValue ?? '');
    }
    if (node.nodeType !== ELEMENT_NODE) return '';

    const inner = () => children(node).map((c) => renderNode(c, context)).join('');
    const name = node.nodeName;

    if (FOREIGN_OUTPUT.has(name)) return '';
    if (HTML_PASSTHROUGH[name]) return `<${HTML_PASSTHROUGH[name]}>${inner()}</${HTML_PASSTHROUGH[name]}>`;

    switch (name) {
        case 'para': {
            const body = inner().trim();
            if (!body) return '';
            // Doxygen puts asides, tables, lists and code blocks inside a
            // <para>. Wrapping those in <p> is invalid HTML: the browser
            // closes the paragraph at the first block element and leaves a
            // stray </p> behind, which shifts everything after it out of the
            // element it was supposed to be in.
            return BLOCK_LEVEL.test(body) ? body : `<p>${body}</p>`;
        }
        case 'computeroutput':
            return `<code>${inner()}</code>`;
        case 'linebreak':
            return '<br />';
        case 'hruler':
            return '<hr />';
        case 'itemizedlist':
            return `<ul>${inner()}</ul>`;
        case 'orderedlist':
            return `<ol>${inner()}</ol>`;
        case 'listitem':
            return `<li>${inner()}</li>`;
        case 'programlisting':
            return renderProgramListing(node, context);
        case 'verbatim':
        case 'preformatted':
            return `<pre class="lapi-code"><code>${escapeHtml(textOf(node))}</code></pre>`;
        case 'htmlonly':
            // Written for HTML output, by an author who meant it literally.
            return textOf(node);
        case 'formula':
            return `<code class="lapi-formula">${escapeHtml(textOf(node).trim())}</code>`;
        case 'ulink':
            return `<a href="${escapeHtml(attr(node, 'url') || '#')}" rel="nofollow">${inner()}</a>`;
        case 'ref': {
            const href = context.resolveRef?.(attr(node, 'refid'));
            const label = inner();
            return href ? `<a href="${escapeHtml(href)}"><code>${label}</code></a>` : `<code>${label}</code>`;
        }
        case 'anchor':
            return '';
        case 'heading':
        case 'title':
            // A heading inside a description would compete with the headings
            // this module emits for the page structure, so it is demoted
            // rather than allowed into the table of contents.
            return `<p class="lapi-subheading">${inner()}</p>`;
        case 'sect1': case 'sect2': case 'sect3': case 'sect4': case 'sect5':
        case 'parblock':
            return inner();
        case 'table':
            return `<div class="lapi-scroll"><table class="lapi-table">${inner()}</table></div>`;
        case 'caption':
            return `<caption>${inner()}</caption>`;
        case 'row':
            return `<tr>${inner()}</tr>`;
        case 'entry': {
            const cell = attr(node, 'thead') === 'yes' ? 'th' : 'td';
            const span = Number(attr(node, 'colspan')) > 1 ? ` colspan="${escapeHtml(attr(node, 'colspan'))}"` : '';
            return `<${cell}${span}>${inner()}</${cell}>`;
        }
        case 'variablelist':
            return renderVariableList(node, context);
        case 'simplesect':
            return renderSimpleSect(node, context);
        case 'xrefsect':
            return renderXrefSect(node, context);
        case 'parameterlist':
            // Lifted into a table by the caller; dropped from the prose.
            return '';
        case 'internal':
            // `@internal` marks everything after it as not for publication.
            // Dropping it here is the whole point of asking Doxygen to keep
            // it in the XML — see build-docs.sh, INTERNAL_DOCS.
            return '';
        case 'sp':
            return ' ';
        case 'nonbreakablespace':
            return '&#160;';
        case 'ndash':
            return '&#8211;';
        case 'mdash':
            return '&#8212;';
        case 'zwj':
            return '';
        case 'emoji':
            return escapeHtml(attr(node, 'unicode'));
        case 'image':
            // Doxygen's images are not copied into the site, so a real <img>
            // would be a broken one. The caption is worth keeping.
            return inner();
        default:
            // Unknown tags keep their content. Losing a wrapper is a cosmetic
            // regression; losing the text inside it is a documentation bug.
            return inner();
    }
}

/** Doxygen file extensions to the languages the highlighter knows. */
const LISTING_LANGUAGES = {
    '.c': 'c', '.h': 'c',
    '.cpp': 'cpp', '.cc': 'cpp', '.cxx': 'cpp', '.hpp': 'cpp', '.hxx': 'cpp',
    '.unparsed': null,
};

function renderProgramListing(node, context) {
    const source = elements(node, 'codeline').map(codeLineText).join('\n');
    const filename = attr(node, 'filename').toLowerCase();
    const language = LISTING_LANGUAGES[filename] ?? undefined;
    if (context.highlight) return context.highlight(source, language);
    return `<pre class="lapi-code"><code>${escapeHtml(source)}</code></pre>`;
}

/**
 * The text of one line of a code block.
 *
 * Indentation inside a listing is `<sp/>` elements rather than spaces, so
 * reading the line as plain text flattens every code sample onto column
 * zero. Each `<sp/>` is one space unless it says otherwise.
 */
function codeLineText(node) {
    if (node.nodeType === TEXT_NODE || node.nodeType === CDATA_NODE) return node.nodeValue ?? '';
    if (node.nodeType !== ELEMENT_NODE) return '';
    if (node.nodeName === 'sp') return ' '.repeat(Math.max(1, Number(attr(node, 'value')) || 1));
    return children(node).map(codeLineText).join('');
}

/* ------------------------------------------------------------ sections */

/** Doxygen sections that map onto one of Starlight's four callouts. The
 *  label is spelled out because the XML carries no `<title>` for these —
 *  falling back to the kind put a lowercase "note" above the note. */
const SIMPLESECT_ASIDES = {
    note: { aside: 'note', label: 'Note' },
    warning: { aside: 'caution', label: 'Warning' },
    attention: { aside: 'caution', label: 'Attention' },
};

/**
 * Doxygen sections rendered as a labelled block.
 *
 * `role` picks the colour: `require` for the contract a caller has to
 * honour, `info` for a pointer elsewhere, `meta` for bookkeeping about the
 * symbol rather than about its behaviour.
 */
const SIMPLESECT_TAGS = {
    pre: { label: 'Precondition', role: 'require' },
    post: { label: 'Postcondition', role: 'require' },
    invariant: { label: 'Invariant', role: 'require' },
    remark: { label: 'Remark', role: 'info' },
    see: { label: 'See also', role: 'info' },
    since: { label: 'Since', role: 'meta' },
    version: { label: 'Version', role: 'meta' },
    date: { label: 'Date', role: 'meta' },
    author: { label: 'Author', role: 'meta' },
    authors: { label: 'Authors', role: 'meta' },
    copyright: { label: 'Copyright', role: 'meta' },
};

/** `@deprecated`, `@todo` and `@bug` reach the XML as cross-reference
 *  sections, identified by the list they belong to rather than by a kind. */
const XREF_ROLES = {
    deprecated: 'danger',
    bug: 'danger',
    todo: 'warning',
    test: 'info',
};

/**
 * A labelled block: the section's name, then its content.
 *
 * This is the shape every non-callout section shares, and the reason a
 * precondition no longer reads as an ordinary sentence in the middle of a
 * description.
 */
export function tagBlock(label, body, role = 'info') {
    if (!body || !String(body).trim()) return '';
    return `<div class="lapi-tag lapi-tag--${escapeHtml(role)}">`
        + `<p class="lapi-tag__label">${escapeHtml(label)}</p>`
        + `<div class="lapi-tag__body">${body}</div></div>`;
}

function renderSimpleSect(node, context) {
    const kind = attr(node, 'kind');
    // `return` and `retval` are lifted into the signature block by the caller.
    if (kind === 'return' || kind === 'retval' || kind === 'rcs') return '';

    const body = children(node)
        .filter((c) => c.nodeName !== 'title')
        .map((c) => renderNode(c, context))
        .join('');
    if (!body.trim()) return '';

    const title = textOf(firstElement(node, 'title')).trim();

    const aside = SIMPLESECT_ASIDES[kind];
    if (aside) {
        return `<aside class="starlight-aside starlight-aside--${aside.aside}">`
            + `<p class="starlight-aside__title">${escapeHtml(title || aside.label)}</p>`
            + `<section class="starlight-aside__content">${body}</section></aside>`;
    }

    // `@par Thread safety:` is how a project adds a section of its own, so
    // it carries its own title and gets the colour reserved for them.
    if (kind === 'par') return tagBlock(title || 'Note', body, 'custom');

    const tag = SIMPLESECT_TAGS[kind];
    if (tag) return tagBlock(title || tag.label, body, tag.role);

    return body;
}

function renderXrefSect(node, context) {
    const title = textOf(firstElement(node, 'xreftitle')).trim();
    const body = renderDescription(firstElement(node, 'xrefdescription'), context);
    // `deprecated_1_deprecated000003` — the list name is the first segment.
    const list = attr(node, 'id').split('_')[0];
    return tagBlock(title || list, body, XREF_ROLES[list] ?? 'custom');
}

/**
 * A Doxygen variable list, as a run of labelled blocks.
 *
 * This is where a project's own `ALIASES` land. An alias that expands to
 * raw HTML — `<dl class='section threadsafety'><dt>Thread Safety</dt><dd>`,
 * the shape every Liara module carries — is parsed back by Doxygen into a
 * `<variablelist>`, so `@threadsafety` and `@par Thread safety:` arrive here
 * as the same thing and come out looking the same. Rendering the parts
 * separately was what made a thread-safety note indistinguishable from the
 * paragraph above it: the `<term>` became a bare line of text and the
 * `<listitem>` an `<li>` with no list around it.
 */
function renderVariableList(node, context) {
    const blocks = [];
    let label = '';

    for (const child of children(node)) {
        if (child.nodeType !== ELEMENT_NODE) continue;
        if (child.nodeName === 'varlistentry') {
            label = textOf(firstElement(child, 'term')).trim();
        } else if (child.nodeName === 'listitem') {
            blocks.push(tagBlock(label || 'Note', children(child).map((c) => renderNode(c, context)).join(''), 'custom'));
            label = '';
        }
    }
    return blocks.join('');
}

/* ------------------------------------------------------------- extraction */

/**
 * Reads one flavour of `<parameterlist>` into rows.
 *
 * `retval` and `exception` used to be dropped on the floor with the rest of
 * the parameter lists — documented return codes and documented throws
 * simply did not appear on the page.
 */
function extractParameterList(detailed, kind, context) {
    const rows = [];
    if (!detailed) return rows;

    for (const list of Array.from(detailed.getElementsByTagName('parameterlist'))) {
        if (attr(list, 'kind') !== kind) continue;
        for (const item of elements(list, 'parameteritem')) {
            const nameList = firstElement(item, 'parameternamelist');
            const description = renderDescription(firstElement(item, 'parameterdescription'), context);
            for (const nameNode of nameList ? elements(nameList, 'parametername') : []) {
                rows.push({
                    name: textOf(nameNode).trim(),
                    direction: attr(nameNode, 'direction') || null,
                    description,
                });
            }
        }
    }
    return rows;
}

/**
 * The parameters of a member, declaration order first.
 *
 * Doxygen states a parameter twice: once in `<param>`, which carries the
 * real type and the declaration order, and once in the `@param` list, which
 * carries the prose. Only the second was being read, so the type column of
 * every parameter table was empty and the order was the author's rather
 * than the function's. Documented names with no matching parameter — a
 * renamed argument, most often — are kept at the end rather than dropped,
 * because a stale entry a reader can see is better than one they cannot.
 */
function extractParameters(memberdef, detailed, context) {
    const documented = extractParameterList(detailed, 'param', context);
    const byName = new Map(documented.map((row) => [row.name, row]));
    const parameters = [];

    for (const node of elements(memberdef, 'param')) {
        const name = textOf(firstElement(node, 'declname')).trim()
            || textOf(firstElement(node, 'defname')).trim();
        const row = byName.get(name);
        byName.delete(name);
        parameters.push({
            name,
            type: renderInline(firstElement(node, 'type'), context),
            defaultValue: textOf(firstElement(node, 'defval')).trim(),
            direction: row?.direction ?? null,
            description: row?.description ?? '',
        });
    }

    for (const row of byName.values()) {
        parameters.push({ name: row.name, type: '', defaultValue: '', ...row });
    }

    // A C prototype with no arguments has one parameter of type `void`. It
    // is grammar, not an argument, and a table row for it says nothing.
    if (parameters.length === 1 && !parameters[0].name && parameters[0].type === 'void') return [];
    return parameters;
}

function extractReturns(detailed, context) {
    if (!detailed) return '';
    for (const section of Array.from(detailed.getElementsByTagName('simplesect'))) {
        if (attr(section, 'kind') === 'return') {
            return children(section)
                .filter((c) => c.nodeName !== 'title')
                .map((c) => renderNode(c, context))
                .join('')
                .trim();
        }
    }
    return '';
}

/**
 * Qualifiers worth showing beside a symbol's name.
 *
 * They come from attributes rather than from the signature text, so they
 * are reliable even where Doxygen's `definition` string omits them.
 */
function extractFlags(memberdef) {
    const flags = [];
    if (isYes(memberdef, 'static')) flags.push('static');
    if (isYes(memberdef, 'inline')) flags.push('inline');
    if (isYes(memberdef, 'constexpr')) flags.push('constexpr');
    if (isYes(memberdef, 'consteval')) flags.push('consteval');
    if (isYes(memberdef, 'explicit')) flags.push('explicit');
    if (isYes(memberdef, 'noexcept')) flags.push('noexcept');
    if (isYes(memberdef, 'mutable')) flags.push('mutable');
    if (attr(memberdef, 'virt') === 'virtual') flags.push('virtual');
    if (attr(memberdef, 'virt') === 'pure-virtual') flags.push('pure virtual');
    if (attr(memberdef, 'strong') === 'yes') flags.push('scoped');
    const prot = attr(memberdef, 'prot');
    if (prot && prot !== 'public') flags.push(prot);
    return flags;
}

function extractTemplateParams(node, context) {
    const list = firstElement(node, 'templateparamlist');
    if (!list) return [];
    return elements(list, 'param').map((param) => ({
        type: renderInline(firstElement(param, 'type'), context),
        name: textOf(firstElement(param, 'declname')).trim()
            || textOf(firstElement(param, 'defname')).trim(),
        defaultValue: textOf(firstElement(param, 'defval')).trim(),
    }));
}

/** Whether a description carries an `@internal` marker anywhere in it. */
function hasInternalMarker(node) {
    return Boolean(node && node.getElementsByTagName('internal').length > 0);
}

function parseMember(memberdef, context, compound) {
    const kind = attr(memberdef, 'kind');
    const rawName = textOf(firstElement(memberdef, 'name')).trim();
    const detailed = firstElement(memberdef, 'detaileddescription');
    const anonymous = isAnonymousName(rawName);

    const member = {
        kind,
        name: rawName,
        anonymous,
        id: attr(memberdef, 'id'),
        slug: slugify(rawName),
        prot: attr(memberdef, 'prot') || 'public',
        flags: extractFlags(memberdef),
        type: renderInline(firstElement(memberdef, 'type'), context),
        typeText: textOf(firstElement(memberdef, 'type')).trim(),
        definition: textOf(firstElement(memberdef, 'definition')).trim(),
        args: textOf(firstElement(memberdef, 'argsstring')).trim(),
        initializer: textOf(firstElement(memberdef, 'initializer')).trim(),
        brief: renderDescription(firstElement(memberdef, 'briefdescription'), context),
        detailed: renderDescription(detailed, context),
        parameters: extractParameters(memberdef, detailed, context),
        templateParams: extractTemplateParams(memberdef, context),
        returns: extractReturns(detailed, context),
        retvals: extractParameterList(detailed, 'retval', context),
        exceptions: extractParameterList(detailed, 'exception', context),
        internal: hasInternalMarker(detailed),
        location: parseLocation(firstElement(memberdef, 'location')),
    };

    if (kind === 'enum') {
        member.values = elements(memberdef, 'enumvalue').map((value) => ({
            id: attr(value, 'id'),
            name: textOf(firstElement(value, 'name')).trim(),
            slug: slugify(textOf(firstElement(value, 'name')).trim()),
            initializer: textOf(firstElement(value, 'initializer')).trim(),
            // Doxygen puts a trailing `/**< … */` comment on an enum value
            // into detaileddescription, not briefdescription, so both are
            // consulted wherever an enumerator's prose is read.
            brief: renderDescription(firstElement(value, 'briefdescription'), context),
            detailed: renderDescription(firstElement(value, 'detaileddescription'), context),
        }));
        if (anonymous) {
            member.name = anonymousEnumLabel(member.values);
            member.slug = slugify(member.name.replace(/\*$/, ''));
        }
    }

    member.documented = Boolean(
        member.brief || member.detailed
        || member.values?.some((value) => value.brief || value.detailed),
    );

    // Doxygen reads a macro invocation sitting at file scope — the
    // `LIARA_STATIC_ASSERT(…)` guarding an ABI constant, a `DECLARE_HANDLE(…)`
    // — as a function declaration, and it has been showing up in the
    // Functions section of the header that uses it. A file-scope function
    // with no return type is not something C or C++ can declare, so this is
    // the one shape that identifies the artefact without guessing. A
    // documented one is left alone: someone meant that.
    member.macroArtefact = Boolean(
        compound?.kind === 'file'
        && kind === 'function'
        && !member.typeText
        && !member.documented,
    );

    return member;
}

function parseLocation(node) {
    if (!node) return null;
    return {
        file: attr(node, 'file') || null,
        line: Number(attr(node, 'line')) || null,
    };
}

/** Reconstructs a declaration the way it appears in the header. */
export function signatureOf(member) {
    const template = member.templateParams?.length
        ? `template <${member.templateParams.map(templateParamText).join(', ')}>\n`
        : '';
    const qualifiers = member.flags
        .filter((flag) => ['static', 'inline', 'constexpr', 'consteval', 'explicit', 'virtual'].includes(flag))
        .filter((flag) => !member.definition.startsWith(flag))
        .join(' ');
    const prefix = qualifiers ? `${qualifiers} ` : '';

    switch (member.kind) {
        case 'function':
            return `${template}${prefix}${member.definition}${member.args}`.trim();
        case 'typedef':
            return `typedef ${member.typeText} ${member.name}${member.args}`.trim();
        case 'define': {
            const parameters = member.parameters.length
                ? `(${member.parameters.map((parameter) => parameter.name).join(', ')})`
                : '';
            return `#define ${member.name}${parameters}${member.initializer ? ` ${member.initializer}` : ''}`.trim();
        }
        case 'enum':
            return member.anonymous
                ? `enum {\n${(member.values ?? []).map((value) => `    ${value.name}${value.initializer ? ` ${value.initializer}` : ''},`).join('\n')}\n}`
                : `enum ${member.flags.includes('scoped') ? 'class ' : ''}${member.name}`
                  + `${member.typeText ? ` : ${member.typeText}` : ''}`;
        case 'variable':
            return `${template}${prefix}${member.definition || `${member.typeText} ${member.name}`}${member.args}`
                + `${member.initializer ? ` ${member.initializer}` : ''}`.trimEnd();
        default:
            return `${member.typeText} ${member.name}`.trim();
    }
}

function templateParamText(parameter) {
    const type = parameter.type.replace(/<[^>]+>/g, '');
    const rest = [type, parameter.name].filter(Boolean).join(' ');
    return parameter.defaultValue ? `${rest} = ${parameter.defaultValue}` : rest;
}

/* ---------------------------------------------------------------- compounds */

/**
 * Reads one Doxygen compound XML file into a structured model.
 *
 * @param {string} path    Path to the compound's XML file.
 * @param {object} context Cross-reference resolution and highlighting.
 * @returns {object|null} The compound, or null when the file has no compounddef.
 */
export function parseCompound(path, context = {}) {
    const document = new DOMParser().parseFromString(readFileSync(path, 'utf-8'), 'text/xml');
    const node = document.getElementsByTagName('compounddef')[0];
    if (!node) return null;

    const name = textOf(firstElement(node, 'compoundname')).trim();
    const detailed = firstElement(node, 'detaileddescription');
    const compound = {
        id: attr(node, 'id'),
        kind: attr(node, 'kind'),
        language: attr(node, 'language'),
        name,
        slug: compoundSlug(name),
        anonymous: isAnonymousName(name),
        brief: renderDescription(firstElement(node, 'briefdescription'), context),
        detailed: renderDescription(detailed, context),
        templateParams: extractTemplateParams(node, context),
        internal: hasInternalMarker(detailed),
        members: [],
        // What this compound contains that has a page of its own: the types
        // a header declares, the types and namespaces a namespace holds. A
        // header that declares everything inside a namespace has no members
        // at all, and without these its page would be prose and nothing else.
        innerClasses: [
            ...elements(node, 'innerclass'),
            ...elements(node, 'innernamespace'),
        ].map((inner) => ({
            refid: attr(inner, 'refid'),
            prot: attr(inner, 'prot'),
            name: textOf(inner).trim(),
        })).filter((inner) => !isAnonymousName(inner.name)),
        baseClasses: elements(node, 'basecompoundref').map((base) => ({
            refid: attr(base, 'refid'),
            prot: attr(base, 'prot'),
            name: textOf(base).trim(),
        })),
        location: parseLocation(firstElement(node, 'location')),
    };

    for (const section of elements(node, 'sectiondef')) {
        for (const memberdef of elements(section, 'memberdef')) {
            compound.members.push(parseMember(memberdef, context, compound));
        }
    }

    // Grouped by kind, and inside a group left exactly as declared. The
    // order fields are written in is part of a C struct's meaning — it is
    // its layout — and the order functions are written in is how the author
    // grouped them. Alphabetising either throws away information that is
    // free to keep, so build-docs.sh switches Doxygen's own sorting off and
    // this sort is stable.
    compound.members.sort((a, b) => memberKindRank(a.kind) - memberKindRank(b.kind));

    return compound;
}

function memberKindRank(kind) {
    const rank = MEMBER_ORDER.indexOf(kind);
    return rank === -1 ? MEMBER_ORDER.length : rank;
}

export function xmlFilesIn(xmlDir) {
    return readdirSync(xmlDir).filter((name) => name.endsWith('.xml') && name !== 'index.xml');
}

export {
    MEMBER_LABELS, MEMBER_KIND_LABELS, COMPOUND_KIND_LABELS,
    firstElement, elements, textOf,
};
