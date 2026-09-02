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
 *
 * What a page is made of lives in api/render.mjs; what never reaches one
 * lives in api/filter.mjs. This module decides which symbols go on which
 * page, in what order, and under what heading.
 */

import {
    MEMBER_LABELS, MEMBER_ORDER, escapeHtml, parseCompound, signatureOf,
    slugify, xmlFilesIn,
} from './doxygen.mjs';
import {
    createCompoundFilter, isPublishedMember, isWorthPublishing,
    DEFAULT_EXCLUDE_PATTERNS,
} from './filter.mjs';
import {
    aggregateDeclaration, compoundHeader, enumTable, exceptionTable, fieldTable,
    includeLine, memberCard, parameterTable, returnsBlock, shortArguments,
    signatureBlock, sourceLink, synopsisTable, table, templateParamTable,
    undocumentedBlock, COMPOUND_KIND_LABELS, MEMBER_KIND_LABELS,
} from './render.mjs';
import { join } from 'node:path';
import { plainHighlight } from './highlight.mjs';

/** Compound kinds that carry documentation worth a page. `dir` and `page`
 *  are Doxygen bookkeeping and are skipped. */
const DOCUMENTED_KINDS = new Set(['file', 'struct', 'union', 'class', 'namespace', 'interface', 'concept']);

/** Section headings on a page that documents a type rather than a header:
 *  a struct's variables are its fields, and calling them "Variables" is the
 *  kind of small wrongness that makes a generated page feel machine-made. */
const TYPE_MEMBER_LABELS = {
    variable: 'Fields',
    function: 'Member functions',
    typedef: 'Member typedefs',
    enum: 'Member enumerations',
};

const TYPE_KINDS = new Set(['struct', 'union', 'class', 'interface']);

function sectionLabel(kind, compoundKind) {
    if (TYPE_KINDS.has(compoundKind) && TYPE_MEMBER_LABELS[kind]) return TYPE_MEMBER_LABELS[kind];
    return MEMBER_LABELS[kind] ?? `${kind.charAt(0).toUpperCase()}${kind.slice(1)}s`;
}

/** Every member kind present, the ones worth leading with first. */
function orderedKinds(members) {
    const present = [...new Set(members.map((member) => member.kind))];
    return [
        ...MEMBER_ORDER.filter((kind) => present.includes(kind)),
        ...present.filter((kind) => !MEMBER_ORDER.includes(kind)).sort(),
    ];
}

/* ---------------------------------------------------------------- anchors */

/**
 * Assigns one anchor per symbol in a compound.
 *
 * A name can repeat across kinds — a `typedef liara_result` and an `enum
 * liara_result` are two symbols with one name — so a collision has to be
 * broken. It is broken by suffixing *every* colliding symbol with its kind
 * rather than letting the first one keep the bare slug: which symbol comes
 * first depends on the order the caller happens to iterate in, and this
 * function is called twice, from two different places, which have to agree.
 *
 * @param {Array<{name: string, kind: string}>} entries
 * @returns {Map<string, string>} `"<name>\0<kind>"` to anchor.
 */
export function allocateSlugs(entries) {
    const kindsByName = new Map();
    for (const entry of entries) {
        const base = slugify(entry.name);
        if (!kindsByName.has(base)) kindsByName.set(base, new Set());
        kindsByName.get(base).add(entry.kind);
    }

    const slugs = new Map();
    for (const entry of entries) {
        const base = slugify(entry.name);
        const contested = kindsByName.get(base).size > 1;
        slugs.set(`${entry.name}\u0000${entry.kind}`, contested ? `${base}-${entry.kind}` : base);
    }
    return slugs;
}

/* --------------------------------------------------------- cross-references */

/**
 * What a `@ref` becomes while a description is being rendered.
 *
 * Resolution is deferred rather than done in place, and that ordering is the
 * whole design. A reference can point at a symbol in a file that has not
 * been read yet, at a symbol that is about to be filtered out, or at a
 * typedef that is about to be folded into the type it names — and the
 * anchor a symbol ends up with is not known until every member of its
 * compound is final, because a name shared by two kinds makes both of them
 * carry a suffix. Rendering the link at parse time meant guessing all three
 * from `index.xml` and being wrong often enough to publish links that 404.
 *
 * So the renderer emits this sentinel, and `resolveReferences` turns it into
 * a URL once nothing can change — or unwraps it back to plain code, which is
 * what Doxygen itself does with a reference it cannot resolve.
 */
export const REF_SENTINEL = '#liara-ref:';

/** URL of the page a compound is published as. */
function compoundUrl(compound, apiBase) {
    return `${apiBase}/${compound.slug}/`;
}

/** Where a member lives: its own page under the symbol split, an anchor on
 *  its compound's page otherwise. */
function memberUrl(compound, member, { split, apiBase }) {
    return split === 'symbol' && compound.kind === 'file'
        ? `${apiBase}/${member.slug}/`
        : `${compoundUrl(compound, apiBase)}#${member.slug}`;
}

/**
 * Records where every published symbol ended up.
 *
 * Built from the parsed compounds rather than from `index.xml`, so what it
 * contains is exactly what exists: a symbol that was filtered out has no
 * entry, and a reference to it degrades to plain code instead of pointing
 * at a page nobody generated.
 */
function indexReferences(compounds, refMap, settings) {
    for (const compound of compounds) {
        refMap.set(compound.id, compoundUrl(compound, settings.apiBase));
        for (const member of compound.members) {
            const url = memberUrl(compound, member, settings);
            refMap.set(member.id, url);
            const page = url.split('#')[0];
            for (const value of member.values ?? []) refMap.set(value.id, `${page}#${value.slug}`);
        }
    }
}

/**
 * Turns every deferred reference into a link, or into plain code.
 *
 * A reference survives as a link only if the page it names was generated
 * *and* carries the anchor it asks for. Both halves matter: the target may
 * have been excluded, or may have kept its page and lost the member.
 */
export function resolveReferences(html, { refMap, pages, apiBase }) {
    const known = new Map(pages.map((page) => [`${apiBase}/${page.slug}/`, page.anchors ?? new Set()]));
    const pattern = new RegExp(`<a href="${REF_SENTINEL}([^"]+)"><code>([\\s\\S]*?)</code></a>`, 'g');

    return html.replace(pattern, (_match, refid, label) => {
        const href = refMap.get(refid);
        if (!href) return `<code>${label}</code>`;
        const [path, anchor] = href.split('#');
        const anchors = known.get(path);
        if (!anchors || (anchor && !anchors.has(anchor))) return `<code>${label}</code>`;
        return `<a href="${escapeHtml(href)}"><code>${label}</code></a>`;
    });
}

/* ------------------------------------------------------------------- pages */

/**
 * A frontmatter description must be plain text, so tags are stripped and
 * the result is clipped to something a search result can show.
 */
function textSummary(html, limit = 160) {
    if (!html) return '';
    const text = String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`;
}

/** Synopsis rows for the types a header declares, which have pages of
 *  their own — a reader looking at `liara_version.h` wants `liara_version`
 *  listed there, not only in the sidebar. */
function innerClassEntries(compound, { apiBase, resolveCompound }) {
    return compound.innerClasses
        .map((inner) => resolveCompound(inner.name))
        .filter(Boolean)
        .map((target) => ({
            kind: target.kind,
            label: COMPOUND_KIND_LABELS[target.kind] ?? target.kind,
            name: target.name,
            href: `${apiBase}/${target.slug}/`,
            brief: target.brief,
        }));
}

function memberEntries(members) {
    return members.map((member) => ({
        kind: member.kind,
        label: MEMBER_KIND_LABELS[member.kind] ?? member.kind,
        name: member.name,
        suffix: shortArguments(member),
        href: `#${member.slug}`,
        brief: member.brief || member.detailed,
    }));
}

/** Below this, the synopsis repeats the page instead of summarising it. */
const SYNOPSIS_MINIMUM = 3;

function fileSplitPage(compound, settings) {
    const { sourceUrl, highlight } = settings;

    // A field of a struct is listed whether or not anybody described it:
    // the layout is the documentation, and a layout with a hole in it is
    // not one. Everything else obeys the ordinary rule — described symbols
    // get a card, the rest are listed at the foot of the page.
    const tabled = (member) => TYPE_KINDS.has(compound.kind) && member.kind === 'variable';
    const shown = compound.members.filter((member) => member.documented || tabled(member));
    const undocumented = compound.members.filter((member) => !member.documented && !tabled(member));

    const headings = [];
    const parts = [
        compoundHeader(compound, sourceUrl),
        compound.brief ? `<div class="lapi-lead">${compound.brief}</div>` : '',
        compound.detailed,
        includeLine(compound),
        aggregateDeclaration(compound, highlight),
    ];

    // A struct whose members are all fields is already summarised by its
    // field table; a synopsis above it would be the same rows twice.
    // Anything with a page of its own appears here or nowhere: a header
    // that declares everything inside a namespace has no members, and
    // without the synopsis its page would say nothing about its contents.
    const elsewhere = innerClassEntries(compound, settings);
    const synopsis = [...elsewhere, ...memberEntries(shown)];
    const fieldsOnly = shown.length > 0 && shown.every(tabled);
    if ((elsewhere.length > 0 || synopsis.length >= SYNOPSIS_MINIMUM) && !fieldsOnly) {
        headings.push({ depth: 2, slug: 'synopsis', text: 'Synopsis' });
        parts.push('<h2 id="synopsis">Synopsis</h2>', synopsisTable(synopsis));
    }

    for (const kind of orderedKinds(shown)) {
        const group = shown.filter((member) => member.kind === kind);
        const label = sectionLabel(kind, compound.kind);
        const groupSlug = slugify(label);

        headings.push({ depth: 2, slug: groupSlug, text: label });
        parts.push(`<h2 id="${groupSlug}">${escapeHtml(label)}</h2>`);

        if (group.every(tabled)) {
            parts.push(fieldTable(group));
            continue;
        }

        for (const member of group) {
            headings.push({ depth: 3, slug: member.slug, text: member.name });
            parts.push(memberCard(member, settings));
        }
    }

    parts.push(undocumentedBlock(undocumented));

    return {
        slug: compound.slug,
        title: compound.name,
        description: textSummary(compound.brief) || `API reference for ${compound.name}.`,
        html: parts.filter(Boolean).join('\n'),
        headings,
        anchors: anchorsOf(compound, headings),
    };
}

/** Every id a page carries, so a cross-reference into it can be checked. */
function anchorsOf(compound, headings = []) {
    const anchors = new Set(headings.map((heading) => heading.slug));
    for (const member of compound.members) {
        anchors.add(member.slug);
        for (const value of member.values ?? []) anchors.add(value.slug);
    }
    return anchors;
}

function symbolSplitPages(compound, settings) {
    const { sourceUrl, highlight } = settings;

    // A struct, union or class is one page listing its fields. A field does
    // not get a page of its own: five `*_desc` structs each declaring `abi`
    // would otherwise produce five pages all claiming the slug `abi`, with
    // four of them silently lost.
    if (compound.kind !== 'file') return [fileSplitPage(compound, settings)];

    return compound.members.filter((member) => member.documented).map((member) => {
        const headings = [];
        const parts = [
            `<div class="lapi-meta">${
                `<span class="lapi-badge lapi-badge--${escapeHtml(member.kind)}">`
                + `${escapeHtml(MEMBER_KIND_LABELS[member.kind] ?? member.kind)}</span>`
            }<span class="lapi-meta__path"><code>${escapeHtml(compound.name)}</code></span></div>`,
            signatureBlock(member, highlight),
            member.brief ? `<div class="lapi-lead">${member.brief}</div>` : '',
            member.detailed ? `<div class="lapi-prose">${member.detailed}</div>` : '',
        ];

        const section = (slug, label, body) => {
            if (!body) return;
            headings.push({ depth: 2, slug, text: label });
            parts.push(`<h2 id="${slug}">${escapeHtml(label)}</h2>`, body);
        };

        section('template-parameters', 'Template parameters', templateParamTable(member));
        section('parameters', 'Parameters', parameterTable(member));
        section('returns', 'Returns', stripBlockHeading(returnsBlock(member)));
        section('throws', 'Throws', stripBlockHeading(exceptionTable(member)));
        section('enumerators', 'Enumerators', stripBlockHeading(enumTable(member)));
        parts.push(sourceLink(member.location, sourceUrl));

        return {
            slug: member.slug,
            title: member.name,
            description: textSummary(member.brief) || `${member.kind} declared in ${compound.name}.`,
            html: parts.filter(Boolean).join('\n'),
            headings,
            anchors: new Set([
                ...headings.map((heading) => heading.slug),
                ...(member.values ?? []).map((value) => value.slug),
            ]),
        };
    });
}

/** On a page devoted to one symbol the block titles become the page's own
 *  headings, so the block keeps its content and loses its label. */
function stripBlockHeading(html) {
    return html.replace(/^<div class="lapi-block[^"]*"><h4 class="lapi-block__title">[^<]*<\/h4>/, '<div class="lapi-block">');
}

/**
 * Drops typedefs that merely name a type documented elsewhere.
 *
 * `typedef struct liara_version liara_version;` and `typedef enum
 * liara_result liara_result;` are the ordinary C spelling of a named type,
 * not a second symbol. Left alone they document the same thing twice on the
 * same page — same name, same brief, one above the other — and under the
 * symbol split they produce a page competing for the slug of the struct or
 * enum they alias, with one of the two silently lost. The alias is dropped
 * and every reference to it redirected, so a `@ref liara_version` in a doc
 * comment still lands on the type it meant.
 *
 * @param {Array} compounds Every parsed compound, mutated in place.
 * @returns {Array<{refid: string, compound: object, member: object|null}>}
 *          The redirects to apply once anchors are final.
 */
function dropAliasTypedefs(compounds) {
    const canonical = new Map();
    for (const compound of compounds) {
        if (compound.kind !== 'file') canonical.set(compound.name, { compound, member: null });
        for (const member of compound.members) {
            if (member.kind !== 'typedef') canonical.set(member.name, { compound, member });
        }
    }

    const redirects = [];
    for (const compound of compounds) {
        if (compound.kind !== 'file') continue;
        compound.members = compound.members.filter((member) => {
            const target = member.kind === 'typedef' ? canonical.get(member.name) : null;
            if (!target) return true;
            redirects.push({ refid: member.id, ...target });
            return false;
        });
    }
    return redirects;
}

/* --------------------------------------------------------------- assembly */

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
 * @param {string[]} [options.exclude]      Glob patterns replacing the default
 *                                          set; see api/filter.mjs.
 * @param {Function} [options.onSkip]       Called with `(name, reason)` for
 *                                          every compound left out.
 * @returns {Array<{slug, title, description, html, headings, anchors}>}
 */
export function buildApiPages(xmlDir, options = {}) {
    const split = options.split ?? 'file';
    const apiBase = options.apiBase ?? '/api';
    const highlight = options.highlight ?? plainHighlight;
    const exclude = options.exclude ?? DEFAULT_EXCLUDE_PATTERNS;
    const onSkip = options.onSkip ?? (() => {});

    const refMap = new Map();
    const context = { resolveRef: (refid) => (refid ? `${REF_SENTINEL}${refid}` : null), highlight };
    const exclusionReason = createCompoundFilter({ exclude });

    const compounds = [];
    for (const file of xmlFilesIn(xmlDir)) {
        const compound = parseCompound(join(xmlDir, file), context);
        if (!compound || !DOCUMENTED_KINDS.has(compound.kind)) continue;

        const reason = exclusionReason(compound);
        if (reason) { onSkip(compound.name, reason); continue; }

        compound.members = compound.members.filter(isPublishedMember);
        compounds.push(compound);
    }

    const redirects = dropAliasTypedefs(compounds);

    const published = compounds.filter((compound) => {
        if (isWorthPublishing(compound)) return true;
        onSkip(compound.name, 'nothing documented in it');
        return false;
    });

    // Anchors are allocated once the members are final, so one never carries
    // a `-function` suffix earned by a symbol that was filtered out.
    for (const compound of published) assignMemberSlugs(compound);

    const byName = new Map(published.map((compound) => [compound.name, compound]));
    const settings = {
        ...options, apiBase, split, highlight,
        resolveCompound: (name) => byName.get(name) ?? null,
    };

    indexReferences(published, refMap, settings);
    for (const { refid, compound, member } of redirects) {
        refMap.set(refid, member ? memberUrl(compound, member, settings) : compoundUrl(compound, apiBase));
    }

    const pages = [];
    for (const compound of published) {
        if (split === 'symbol') pages.push(...symbolSplitPages(compound, settings));
        else pages.push(fileSplitPage(compound, settings));
    }

    pages.sort((a, b) => a.title.localeCompare(b.title));
    pages.unshift(indexPage(published, {
        apiBase, pageSlugs: new Set(pages.map((page) => page.slug)),
    }));

    // Everything generated is scoped to `.lapi`, which is what lets
    // styles/api.css lay these pages out without a single rule of it being
    // able to reach a hand-written one.
    for (const page of pages) {
        page.html = `<div class="lapi">${resolveReferences(page.html, { refMap, pages, apiBase })}</div>`;
    }
    return pages;
}

function assignMemberSlugs(compound) {
    const slugs = allocateSlugs(compound.members);
    for (const member of compound.members) {
        member.slug = slugs.get(`${member.name}\u0000${member.kind}`) ?? slugify(member.name);
    }
}

/* ------------------------------------------------------------- index page */

/** How the compounds are grouped on the section index, in reading order. */
const INDEX_GROUPS = [
    { title: 'Headers', kinds: ['file'] },
    { title: 'Data structures', kinds: ['struct', 'union', 'class', 'interface'] },
    { title: 'Namespaces', kinds: ['namespace'] },
    { title: 'Concepts', kinds: ['concept'] },
];

function indexPage(compounds, { apiBase, pageSlugs }) {
    const parts = [
        '<div class="lapi-lead">Every symbol below is generated from the annotated '
        + 'headers, so this page cannot drift from the code it documents.</div>',
    ];
    const headings = [];

    for (const group of INDEX_GROUPS) {
        const members = compounds
            .filter((compound) => group.kinds.includes(compound.kind))
            .sort((a, b) => a.name.localeCompare(b.name));
        if (members.length === 0) continue;

        const slug = slugify(group.title);
        headings.push({ depth: 2, slug, text: group.title });
        parts.push(`<h2 id="${slug}">${escapeHtml(group.title)}</h2>`);

        // Under the symbol split a header has no page of its own — its
        // symbols each got one — but it is still worth listing: it is how a
        // reader finds out which header declares what. It just is not a link.
        const rows = members.map((compound) => [
            pageSlugs.has(compound.slug)
                ? `<a href="${escapeHtml(`${apiBase}/${compound.slug}/`)}"><code>${escapeHtml(compound.name)}</code></a>`
                : `<code>${escapeHtml(compound.name)}</code>`,
            textSummary(compound.brief, 110),
            contentCounts(compound),
        ]);
        parts.push(table('lapi-index', ['Name', 'Summary', 'Contents'], rows));
    }

    return {
        slug: 'index',
        title: 'API reference',
        description: 'Generated from the public headers.',
        html: parts.join('\n'),
        headings,
        anchors: new Set(headings.map((heading) => heading.slug)),
    };
}

/** `3 functions · 1 enum` — what is inside a compound, before opening it. */
function contentCounts(compound) {
    const isType = TYPE_KINDS.has(compound.kind);
    const documented = compound.members.filter((member) => member.documented
        || (isType && member.kind === 'variable'));
    const counts = orderedKinds(documented).map((kind) => {
        const total = documented.filter((member) => member.kind === kind).length;
        const label = isType && kind === 'variable' ? 'field' : (MEMBER_KIND_LABELS[kind] ?? kind);
        return `<span class="lapi-count">${total}&nbsp;${escapeHtml(total === 1 ? label : `${label}s`)}</span>`;
    });
    if (compound.innerClasses.length > 0) {
        const total = compound.innerClasses.length;
        counts.unshift(`<span class="lapi-count">${total}&nbsp;${total === 1 ? 'type' : 'types'}</span>`);
    }
    return counts.join('');
}

export { DOCUMENTED_KINDS, signatureOf };
