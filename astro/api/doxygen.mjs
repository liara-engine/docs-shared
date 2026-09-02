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
 * computeroutput, ref, simplesect, parameterlist and a dozen more — so the
 * conversion is a recursive walk over known tags with a conservative
 * fallback for anything unrecognised.
 */

import { DOMParser } from '@xmldom/xmldom';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Block-level elements that may not appear inside a <p>. */
const BLOCK_LEVEL = /<(?:aside|table|pre|ul|ol|div|h[1-6]|blockquote)[\s>]/;

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const CDATA_NODE = 4;

/** Member kinds worth a page section, in the order they should appear.
 *  Ordering is by what a reader looks for first, not by Doxygen's own. */
export const MEMBER_ORDER = ['define', 'typedef', 'enum', 'function', 'variable'];

const MEMBER_LABELS = {
    define: 'Macros',
    typedef: 'Typedefs',
    enum: 'Enumerations',
    function: 'Functions',
    variable: 'Variables',
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
 * Turns a symbol name into a URL-safe slug.
 *
 * Doxygen's own identifiers (`liara__version_8h_1a8ac655b2...`) are stable
 * but unreadable and change whenever a signature does, so they are used for
 * cross-reference resolution only and never appear in a URL.
 */
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

export function slugify(name) {
    return String(name)
        .replace(/::/g, '-')
        .replace(/[^A-Za-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase();
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

/* ------------------------------------------------------- description → HTML */

/**
 * Renders a Doxygen description subtree as HTML.
 *
 * @param {Node|null} node    The `briefdescription` or `detaileddescription`.
 * @param {object}    context Cross-reference resolution: `{ resolveRef }`
 *                            maps a Doxygen refid to a URL, or returns null
 *                            to render the reference as plain code.
 * @returns {string} HTML, or an empty string when the node is absent or blank.
 */
export function renderDescription(node, context = {}) {
    if (!node) return '';
    return children(node).map((child) => renderNode(child, context)).join('').trim();
}

function renderNode(node, context) {
    if (node.nodeType === TEXT_NODE || node.nodeType === CDATA_NODE) {
        return escapeHtml(node.nodeValue ?? '');
    }
    if (node.nodeType !== ELEMENT_NODE) return '';

    const inner = () => children(node).map((c) => renderNode(c, context)).join('');

    switch (node.nodeName) {
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
        case 'bold':
            return `<strong>${inner()}</strong>`;
        case 'emphasis':
            return `<em>${inner()}</em>`;
        case 'linebreak':
            return '<br />';
        case 'itemizedlist':
            return `<ul>${inner()}</ul>`;
        case 'orderedlist':
            return `<ol>${inner()}</ol>`;
        case 'listitem':
            return `<li>${inner()}</li>`;
        case 'programlisting':
            return `<pre><code>${escapeHtml(renderProgramListing(node))}</code></pre>`;
        case 'verbatim':
            return `<pre><code>${escapeHtml(textOf(node))}</code></pre>`;
        case 'ulink':
            return `<a href="${escapeHtml(node.getAttribute('url') ?? '#')}" rel="nofollow">${inner()}</a>`;
        case 'ref': {
            const href = context.resolveRef?.(node.getAttribute('refid'));
            const label = inner();
            return href ? `<a href="${escapeHtml(href)}"><code>${label}</code></a>` : `<code>${label}</code>`;
        }
        case 'heading': {
            // Doxygen headings inside a description would compete with the
            // headings this module emits for the page structure, so they are
            // demoted rather than allowed into the table of contents.
            return `<strong>${inner()}</strong>`;
        }
        case 'table':
            return `<table>${inner()}</table>`;
        case 'row':
            return `<tr>${inner()}</tr>`;
        case 'entry':
            return node.getAttribute('thead') === 'yes' ? `<th>${inner()}</th>` : `<td>${inner()}</td>`;
        case 'simplesect':
            return renderSimpleSect(node, context);
        case 'parameterlist':
            // Extracted into a table by the caller; dropped from the prose.
            return '';
        case 'xrefsect':
            return `<div class="doxygen-xref">${inner()}</div>`;
        case 'sp':
            return ' ';
        default:
            // Unknown tags keep their content. Losing a wrapper is a cosmetic
            // regression; losing the text inside it is a documentation bug.
            return inner();
    }
}

function renderProgramListing(node) {
    return elements(node, 'codeline').map((line) => textOf(line)).join('\n');
}

const SIMPLESECT_ASIDES = {
    note: 'note',
    warning: 'caution',
    attention: 'caution',
    remark: 'tip',
    see: 'tip',
};

function renderSimpleSect(node, context) {
    const kind = node.getAttribute('kind');
    // `return` and `retval` are lifted into the signature block by the caller.
    if (kind === 'return' || kind === 'retval') return '';

    const body = children(node)
        .filter((c) => c.nodeName !== 'title')
        .map((c) => renderNode(c, context))
        .join('');
    if (!body.trim()) return '';

    const aside = SIMPLESECT_ASIDES[kind];
    if (!aside) return body;

    const title = textOf(firstElement(node, 'title')).trim() || kind;
    return `<aside class="starlight-aside starlight-aside--${aside}">`
        + `<p class="starlight-aside__title">${escapeHtml(title)}</p>`
        + `<section class="starlight-aside__content">${body}</section></aside>`;
}

/* ------------------------------------------------------------- extraction */

function extractParameters(detailed, context) {
    const result = [];
    if (!detailed) return result;

    for (const list of Array.from(detailed.getElementsByTagName('parameterlist'))) {
        if (list.getAttribute('kind') !== 'param') continue;
        for (const item of elements(list, 'parameteritem')) {
            const nameList = firstElement(item, 'parameternamelist');
            const nameNode = nameList ? firstElement(nameList, 'parametername') : null;
            result.push({
                name: textOf(nameNode).trim(),
                direction: nameNode?.getAttribute('direction') ?? null,
                description: renderDescription(firstElement(item, 'parameterdescription'), context),
            });
        }
    }
    return result;
}

function extractReturns(detailed, context) {
    if (!detailed) return '';
    for (const section of Array.from(detailed.getElementsByTagName('simplesect'))) {
        if (section.getAttribute('kind') === 'return') {
            return children(section)
                .filter((c) => c.nodeName !== 'title')
                .map((c) => renderNode(c, context))
                .join('')
                .trim();
        }
    }
    return '';
}

function parseMember(memberdef, context) {
    const kind = memberdef.getAttribute('kind');
    const name = textOf(firstElement(memberdef, 'name')).trim();
    const detailed = firstElement(memberdef, 'detaileddescription');

    const member = {
        kind,
        name,
        id: memberdef.getAttribute('id'),
        slug: slugify(name),
        type: textOf(firstElement(memberdef, 'type')).trim(),
        definition: textOf(firstElement(memberdef, 'definition')).trim(),
        args: textOf(firstElement(memberdef, 'argsstring')).trim(),
        initializer: textOf(firstElement(memberdef, 'initializer')).trim(),
        brief: renderDescription(firstElement(memberdef, 'briefdescription'), context),
        detailed: renderDescription(detailed, context),
        parameters: extractParameters(detailed, context),
        returns: extractReturns(detailed, context),
        location: parseLocation(firstElement(memberdef, 'location')),
    };

    if (kind === 'enum') {
        member.values = elements(memberdef, 'enumvalue').map((value) => ({
            name: textOf(firstElement(value, 'name')).trim(),
            initializer: textOf(firstElement(value, 'initializer')).trim(),
            brief: renderDescription(firstElement(value, 'briefdescription'), context),
            detailed: renderDescription(firstElement(value, 'detaileddescription'), context),
        }));
    }

    return member;
}

function parseLocation(node) {
    if (!node) return null;
    return {
        file: node.getAttribute('file'),
        line: Number(node.getAttribute('line')) || null,
    };
}

/** Reconstructs a declaration the way it appears in the header. */
export function signatureOf(member) {
    switch (member.kind) {
        case 'function':
            return `${member.definition}${member.args}`.trim();
        case 'typedef':
            return `typedef ${member.type} ${member.name}${member.args}`.trim();
        case 'define':
            return `#define ${member.name}${member.args}${member.initializer ? ` ${member.initializer}` : ''}`.trim();
        case 'enum':
            return `enum ${member.name}`.trim();
        case 'variable':
            return `${member.type} ${member.name}${member.args}`.trim();
        default:
            return `${member.type} ${member.name}`.trim();
    }
}

/* ---------------------------------------------------------------- compounds */

/**
 * Reads one Doxygen compound XML file into a structured model.
 *
 * @param {string} path    Path to the compound's XML file.
 * @param {object} context Cross-reference resolution.
 * @returns {object|null} The compound, or null when the file has no compounddef.
 */
export function parseCompound(path, context = {}) {
    const document = new DOMParser().parseFromString(readFileSync(path, 'utf-8'), 'text/xml');
    const compound = document.getElementsByTagName('compounddef')[0];
    if (!compound) return null;

    const name = textOf(firstElement(compound, 'compoundname')).trim();
    const members = [];
    for (const section of elements(compound, 'sectiondef')) {
        for (const memberdef of elements(section, 'memberdef')) {
            members.push(parseMember(memberdef, context));
        }
    }

    members.sort((a, b) => {
        const byKind = MEMBER_ORDER.indexOf(a.kind) - MEMBER_ORDER.indexOf(b.kind);
        return byKind !== 0 ? byKind : a.name.localeCompare(b.name);
    });

    return {
        id: compound.getAttribute('id'),
        kind: compound.getAttribute('kind'),
        name,
        slug: compoundSlug(name),
        brief: renderDescription(firstElement(compound, 'briefdescription'), context),
        detailed: renderDescription(firstElement(compound, 'detaileddescription'), context),
        members,
        innerClasses: elements(compound, 'innerclass').map((node) => ({
            refid: node.getAttribute('refid'),
            name: textOf(node).trim(),
        })),
        location: parseLocation(firstElement(compound, 'location')),
    };
}

/**
 * Reads the Doxygen index and returns every compound it lists.
 *
 * @param {string} xmlDir Directory containing `index.xml`.
 * @returns {Array<{refid: string, kind: string, name: string}>}
 */
export function readIndex(xmlDir) {
    const path = join(xmlDir, 'index.xml');
    const document = new DOMParser().parseFromString(readFileSync(path, 'utf-8'), 'text/xml');
    return Array.from(document.getElementsByTagName('compound')).map((node) => ({
        refid: node.getAttribute('refid'),
        kind: node.getAttribute('kind'),
        name: textOf(firstElement(node, 'name')).trim(),
        // index.xml lists every member alongside its compound. Reading them
        // here is what lets a cross-reference resolve to a symbol declared in
        // a file that has not been parsed yet — which is most of them, since
        // headers reference each other freely.
        members: elements(node, 'member').map((member) => ({
            refid: member.getAttribute('refid'),
            kind: member.getAttribute('kind'),
            name: textOf(firstElement(member, 'name')).trim(),
        })),
    }));
}

export function xmlFilesIn(xmlDir) {
    return readdirSync(xmlDir).filter((name) => name.endsWith('.xml') && name !== 'index.xml');
}

export { MEMBER_LABELS, firstElement, elements, textOf };
