/**
 * Liara Engine — Doxygen model to Starlight pages.
 *
 * Two layouts are supported, chosen per module rather than fixed for the
 * pipeline, because the right answer differs by language.
 *
 *   'file'    One page per header. A C header is a coherent unit — the
 *             reader already thinks in terms of `liara_version.h` — and the
 *             page stays short enough to scan. Costs two files per header.
 *
 *   'symbol'  One page per symbol. A C++ module's surface is large enough
 *             that a per-header page becomes a wall, and class members want
 *             their own URLs. Costs two files per symbol, which is an order
 *             of magnitude more, so it is not the default.
 *
 * Anchors never use Doxygen's own identifiers. `liara__version_8h_1a8ac655b2…`
 * is stable only until a signature changes, so a URL built from it would
 * break on a refactor that changed nothing a reader can see.
 */

import {
    MEMBER_LABELS, MEMBER_ORDER, compoundSlug, escapeHtml, parseCompound,
    readIndex, signatureOf, slugify, xmlFilesIn,
} from './doxygen.mjs';
import { join } from 'node:path';
import { plainHighlight } from './highlight.mjs';

/** Compound kinds that carry documentation worth a page. `dir` and `page`
 *  are Doxygen bookkeeping and are skipped. */
const DOCUMENTED_KINDS = new Set(['file', 'struct', 'union', 'class', 'namespace', 'interface']);

/* --------------------------------------------------------- cross-references */

/**
 * Builds a Doxygen-refid to URL map from `index.xml`.
 *
 * The index lists every compound and every member with its refid, so one
 * pass over it is enough to resolve references before any description is
 * rendered — which matters, because a description may reference a symbol
 * declared in a file that has not been parsed yet.
 */
export function buildRefMap(xmlDir, { split, apiBase }) {
    const map = new Map();
    const index = readIndex(xmlDir);

    // Member names can repeat across kinds — a `typedef liara_result` and an
    // `enum liara_result` are two distinct symbols with one name — so slugs
    // are disambiguated on collision rather than silently overwriting.
    const used = new Map();
    const uniqueSlug = (scope, name, kind) => {
        const base = slugify(name);
        const key = `${scope}\u0000${base}`;
        const seen = used.get(key);
        if (seen === undefined) {
            used.set(key, kind);
            return base;
        }
        return `${base}-${kind}`;
    };

    for (const compound of index) {
        if (!DOCUMENTED_KINDS.has(compound.kind)) continue;
        const parent = compoundSlug(compound.name);
        map.set(compound.refid, `${apiBase}/${parent}/`);

        for (const member of compound.members ?? []) {
            const anchor = uniqueSlug(parent, member.name, member.kind);
            if (split !== 'symbol') {
                map.set(member.refid, `${apiBase}/${parent}/#${anchor}`);
            } else if (compound.kind === 'file') {
                // In C every file-level symbol is already globally unique,
                // so it stands alone at the top of the API namespace.
                map.set(member.refid, `${apiBase}/${slugify(member.name)}/`);
            } else {
                // A struct field is not worth a page of its own; it is an
                // anchor on the page of the type that declares it.
                map.set(member.refid, `${apiBase}/${parent}/#${anchor}`);
            }
        }
    }

    return map;
}

/* ------------------------------------------------------------------ pieces */

function signatureBlock(member, highlight) {
    return `<div class="doxygen-signature">${highlight(signatureOf(member))}</div>`;
}

function parameterTable(member) {
    if (member.parameters.length === 0) return '';
    const rows = member.parameters.map((parameter) => {
        const direction = parameter.direction ? ` <span class="doxygen-dir">[${escapeHtml(parameter.direction)}]</span>` : '';
        return `<tr><td><code>${escapeHtml(parameter.name)}</code>${direction}</td>`
            + `<td>${parameter.description || ''}</td></tr>`;
    }).join('');
    return `<table class="doxygen-params"><thead><tr><th>Parameter</th><th>Description</th></tr></thead>`
        + `<tbody>${rows}</tbody></table>`;
}

function returnsBlock(member) {
    if (!member.returns) return '';
    return `<p class="doxygen-returns"><strong>Returns.</strong> ${stripOuterParagraph(member.returns)}</p>`;
}

function stripOuterParagraph(html) {
    const match = html.match(/^<p>([\s\S]*)<\/p>$/);
    return match && !match[1].includes('<p>') ? match[1] : html;
}

function enumTable(member) {
    if (!member.values?.length) return '';
    const rows = member.values.map((value) => {
        // Doxygen puts a trailing `/**< … */` comment on an enum value into
        // detaileddescription, not briefdescription, so both are consulted.
        const description = value.brief || value.detailed || '';
        const initializer = value.initializer ? `<code>${escapeHtml(value.initializer.replace(/^=\s*/, ''))}</code>` : '';
        return `<tr><td><code>${escapeHtml(value.name)}</code></td>`
            + `<td>${initializer}</td><td>${description}</td></tr>`;
    }).join('');
    return `<table class="doxygen-enum"><thead><tr><th>Value</th><th>=</th><th>Description</th></tr></thead>`
        + `<tbody>${rows}</tbody></table>`;
}

function sourceLink(member, sourceUrl) {
    if (!sourceUrl || !member.location?.file) return '';
    const href = `${sourceUrl}/${member.location.file}#L${member.location.line ?? 1}`;
    return `<p class="doxygen-source"><a href="${escapeHtml(href)}">`
        + `${escapeHtml(member.location.file)}:${member.location.line ?? ''}</a></p>`;
}

function memberBody(member, sourceUrl, highlight) {
    return [
        signatureBlock(member, highlight),
        member.brief,
        member.detailed,
        parameterTable(member),
        returnsBlock(member),
        enumTable(member),
        sourceLink(member, sourceUrl),
    ].filter(Boolean).join('\n');
}

/* ------------------------------------------------------------------- pages */

function assignSlugs(compound) {
    const used = new Map();
    for (const member of compound.members) {
        const base = slugify(member.name);
        if (used.has(base)) {
            member.slug = `${base}-${member.kind}`;
        } else {
            used.set(base, member.kind);
            member.slug = base;
        }
    }
}

function fileSplitPage(compound, { sourceUrl, highlight }) {
    assignSlugs(compound);

    const headings = [];
    const parts = [compound.brief, compound.detailed].filter(Boolean);

    for (const kind of MEMBER_ORDER) {
        const group = compound.members.filter((member) => member.kind === kind);
        if (group.length === 0) continue;

        const label = MEMBER_LABELS[kind] ?? kind;
        const groupSlug = slugify(label);
        headings.push({ depth: 2, slug: groupSlug, text: label });
        parts.push(`<h2 id="${groupSlug}">${escapeHtml(label)}</h2>`);

        for (const member of group) {
            headings.push({ depth: 3, slug: member.slug, text: member.name });
            parts.push(`<h3 id="${member.slug}"><code>${escapeHtml(member.name)}</code></h3>`);
            parts.push(memberBody(member, sourceUrl, highlight));
        }
    }

    return {
        slug: compound.slug,
        title: compound.name,
        description: textSummary(compound.brief) || `API reference for ${compound.name}.`,
        html: parts.filter(Boolean).join('\n'),
        headings,
    };
}

function symbolSplitPages(compound, { sourceUrl, highlight }) {
    assignSlugs(compound);

    // A struct, union or class is one page listing its fields. A field does
    // not get a page of its own: five `*_desc` structs each declaring `abi`
    // would otherwise produce five pages all claiming the slug `abi`, with
    // four of them silently lost.
    if (compound.kind !== 'file') {
        return [fileSplitPage(compound, { sourceUrl, highlight })];
    }

    return compound.members.map((member) => {
        const headings = [];
        const parts = [signatureBlock(member, highlight), member.brief, member.detailed];

        if (member.parameters.length > 0) {
            headings.push({ depth: 2, slug: 'parameters', text: 'Parameters' });
            parts.push('<h2 id="parameters">Parameters</h2>', parameterTable(member));
        }
        if (member.returns) {
            headings.push({ depth: 2, slug: 'returns', text: 'Returns' });
            parts.push('<h2 id="returns">Returns</h2>', returnsBlock(member));
        }
        if (member.values?.length) {
            headings.push({ depth: 2, slug: 'values', text: 'Values' });
            parts.push('<h2 id="values">Values</h2>', enumTable(member));
        }
        parts.push(sourceLink(member, sourceUrl));

        return {
            slug: slugify(member.name),
            title: member.name,
            description: textSummary(member.brief) || `${member.kind} declared in ${compound.name}.`,
            html: parts.filter(Boolean).join('\n'),
            headings,
        };
    });
}

/** A frontmatter description must be plain text, so tags are stripped and
 *  the result is clipped to something a search result can show. */
function textSummary(html, limit = 160) {
    if (!html) return '';
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`;
}

/**
 * Drops typedefs that merely name a type documented elsewhere.
 *
 * `typedef struct liara_version liara_version;` and `typedef enum
 * liara_result liara_result;` are the ordinary C spelling of a named type,
 * not a second symbol. Left alone they produce a page competing for the
 * same slug as the struct or enum they alias, and one of the two is lost
 * without a word. The alias is dropped and its reference redirected, so a
 * `@ref liara_version` in a doc comment still lands somewhere useful.
 *
 * @param {Array}  compounds Every parsed compound.
 * @param {Map}    refMap    Mutated in place to redirect the dropped refids.
 * @param {string} apiBase   URL prefix for the redirect targets.
 */
function dropAliasTypedefs(compounds, refMap, apiBase) {
    const canonical = new Map();
    for (const compound of compounds) {
        if (compound.kind !== 'file') {
            canonical.set(compound.name, `${apiBase}/${compound.slug}/`);
        }
        for (const member of compound.members) {
            if (member.kind !== 'typedef') {
                canonical.set(member.name, `${apiBase}/${slugify(member.name)}/`);
            }
        }
    }

    let dropped = 0;
    for (const compound of compounds) {
        if (compound.kind !== 'file') continue;
        compound.members = compound.members.filter((member) => {
            const target = member.kind === 'typedef' && canonical.get(member.name);
            if (!target) return true;
            refMap.set(member.id, target);
            dropped += 1;
            return false;
        });
    }
    return dropped;
}

/**
 * Turns a Doxygen XML directory into a list of pages.
 *
 * @param {string} xmlDir Directory holding `index.xml` and the compounds.
 * @param {object} options
 * @param {'file'|'symbol'} [options.split='file']
 * @param {string} [options.apiBase='/api'] URL prefix for cross-references.
 * @param {string} [options.sourceUrl]      Base URL for source links, e.g.
 *                                          `https://github.com/liara-engine/x/blob/main`.
 * @param {Function} [options.highlight]    Code highlighter; see api/highlight.mjs.
 *                                          Defaults to escaping without colour.
 * @returns {Array<{slug, title, description, html, headings}>}
 */
export function buildApiPages(xmlDir, options = {}) {
    const split = options.split ?? 'file';
    const apiBase = options.apiBase ?? '/api';
    const highlight = options.highlight ?? plainHighlight;
    const settings = { ...options, highlight };
    const refMap = buildRefMap(xmlDir, { split, apiBase });
    const context = { resolveRef: (refid) => refMap.get(refid) ?? null };

    const compounds = [];
    for (const file of xmlFilesIn(xmlDir)) {
        const compound = parseCompound(join(xmlDir, file), context);
        if (!compound || !DOCUMENTED_KINDS.has(compound.kind)) continue;
        if (compound.members.length === 0 && compound.kind === 'file') continue;
        compounds.push(compound);
    }

    if (split === 'symbol') {
        dropAliasTypedefs(compounds, refMap, apiBase);
    }

    const pages = [];
    for (const compound of compounds) {
        if (split === 'symbol') {
            pages.push(...symbolSplitPages(compound, settings));
        } else {
            pages.push(fileSplitPage(compound, settings));
        }
    }

    pages.sort((a, b) => a.title.localeCompare(b.title));
    pages.unshift(indexPage(compounds, { split, apiBase }));
    return pages;
}

function indexPage(compounds, { split, apiBase }) {
    const rows = compounds
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((compound) => {
            const href = `${apiBase}/${compound.slug}/`;
            const label = split === 'symbol' && compound.kind === 'file'
                ? `<code>${escapeHtml(compound.name)}</code>`
                : `<a href="${escapeHtml(href)}"><code>${escapeHtml(compound.name)}</code></a>`;
            const counts = MEMBER_ORDER
                .map((kind) => {
                    const n = compound.members.filter((m) => m.kind === kind).length;
                    return n ? `${n} ${MEMBER_LABELS[kind].toLowerCase()}` : null;
                })
                .filter(Boolean)
                .join(', ');
            return `<tr><td>${label}</td><td>${textSummary(compound.brief, 90)}</td><td>${counts}</td></tr>`;
        })
        .join('');

    return {
        slug: 'index',
        title: 'API reference',
        description: 'Generated from the public headers.',
        html: '<p>Every symbol below is generated from the annotated headers, '
            + 'so this page cannot drift from the code it documents.</p>'
            + `<table><thead><tr><th>Header</th><th>Summary</th><th>Contents</th></tr></thead>`
            + `<tbody>${rows}</tbody></table>`,
        headings: [],
    };
}
