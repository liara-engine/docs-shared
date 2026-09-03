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
    MEMBER_LABELS, MEMBER_ORDER, anonymousOwner, escapeHtml, parseCompound,
    signatureOf, slugify, xmlFilesIn,
} from './doxygen.mjs';
import {
    createCompoundFilter, isPublishedMember, isWorthPublishing,
    DEFAULT_EXCLUDE_PATTERNS,
} from './filter.mjs';
import {
    aggregateDeclaration, compoundHeader, enumTable, exceptionTable, fieldTable,
    includeLine, memberCard, namespaceTree, parameterTable, returnsBlock,
    shortArguments, signatureBlock, sourceLink, synopsisTable, table,
    templateParamTable, undocumentedBlock, COMPOUND_KIND_LABELS,
    MEMBER_KIND_LABELS,
} from './render.mjs';
import { groupForCompound, groupForMember } from './groups.mjs';
import { join } from 'node:path';
import { plainHighlight } from './highlight.mjs';

/** Compound kinds that carry documentation worth a page. `dir` and `page`
 *  are Doxygen bookkeeping and are skipped. */
const DOCUMENTED_KINDS = new Set(['file', 'struct', 'union', 'class', 'namespace', 'interface', 'concept']);

/** Section headings on a page that documents an aggregate rather than a
 *  header: a struct's variables are its fields, and calling them "Variables"
 *  is the kind of small wrongness that makes a generated page feel
 *  machine-made. */
const TYPE_MEMBER_LABELS = {
    variable: 'Fields',
    function: 'Member functions',
    typedef: 'Member typedefs',
    enum: 'Member enumerations',
};

const TYPE_MEMBER_KIND_LABELS = {
    variable: 'field',
};

/**
 * The same, for a type that is a class rather than a record.
 *
 * `function` and `variable` are what the XML calls them, and they are also
 * what a free function and a global variable are called — which is exactly
 * the distinction a reader of a C++ surface needs and was not getting. A
 * member is a method and an attribute, in the vocabulary the language and
 * Doxygen's own output both use, so the badge on the card says so too.
 */
const CLASS_MEMBER_LABELS = {
    variable: 'Attributes',
    function: 'Methods',
    friend: 'Friends',
    typedef: 'Member typedefs',
    enum: 'Member enumerations',
};

const CLASS_MEMBER_KIND_LABELS = {
    variable: 'attribute',
    function: 'method',
};

const TYPE_KINDS = new Set(['struct', 'union', 'class', 'interface']);

/**
 * Whether an aggregate is a class rather than a C record.
 *
 * Doxygen is no help: it reports `language="C++"` for a `.h` full of plain C
 * unless the module sets `OPTIMIZE_OUTPUT_FOR_C`, so the language attribute
 * cannot be trusted to tell the two apart. What can be trusted is the shape.
 * `class` and `interface` do not exist in C; neither do member functions,
 * templates, or a name qualified by a namespace. A C `struct` matches none
 * of those and keeps its fields.
 */
function isClassLike(compound) {
    if (compound.kind === 'class' || compound.kind === 'interface') return true;
    if (!TYPE_KINDS.has(compound.kind)) return false;
    return compound.name.includes('::')
        || (compound.templateParams?.length ?? 0) > 0
        || compound.members.some((member) => member.kind === 'function' || member.kind === 'friend');
}

/** The two label sets a compound's members are described with: the heading
 *  over a group of them, and the badge on one of them. */
function labelsFor(compound) {
    const classLike = isClassLike(compound);
    const aggregate = TYPE_KINDS.has(compound.kind);
    const sections = classLike ? CLASS_MEMBER_LABELS : aggregate ? TYPE_MEMBER_LABELS : null;
    const kinds = classLike ? CLASS_MEMBER_KIND_LABELS : aggregate ? TYPE_MEMBER_KIND_LABELS : null;

    return {
        section: (kind) => sections?.[kind]
            ?? MEMBER_LABELS[kind]
            ?? `${kind.charAt(0).toUpperCase()}${kind.slice(1)}s`,
        kind: (kind) => kinds?.[kind] ?? MEMBER_KIND_LABELS[kind] ?? kind,
    };
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
        ? `${apiBase}/${member.pageSlug}/`
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
            href: target.hasPage ? `${apiBase}/${target.slug}/` : null,
            brief: target.brief,
        }));
}

function memberEntries(members, labels) {
    return members.map((member) => ({
        kind: member.kind,
        label: labels.kind(member.kind),
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
    const labels = labelsFor(compound);

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
    const synopsis = [...elsewhere, ...memberEntries(shown, labels)];
    const fieldsOnly = shown.length > 0 && shown.every(tabled);
    if ((elsewhere.length > 0 || synopsis.length >= SYNOPSIS_MINIMUM) && !fieldsOnly) {
        headings.push({ depth: 2, slug: 'synopsis', text: 'Synopsis' });
        parts.push('<h2 id="synopsis">Synopsis</h2>', synopsisTable(synopsis));
    }

    for (const kind of orderedKinds(shown)) {
        const group = shown.filter((member) => member.kind === kind);
        const label = labels.section(kind);
        const groupSlug = slugify(label);

        headings.push({ depth: 2, slug: groupSlug, text: label });
        parts.push(`<h2 id="${groupSlug}">${escapeHtml(label)}</h2>`);

        if (group.every(tabled)) {
            parts.push(fieldTable(group));
            continue;
        }

        for (const member of group) {
            headings.push({ depth: 3, slug: member.slug, text: member.name });
            parts.push(memberCard(member, { ...settings, labels }));
        }
    }

    parts.push(undocumentedBlock(undocumented, labels));

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
    // `hasPage` still decides for anything that is not a header — a namespace
    // holding nothing of its own has no page under either split.
    if (compound.kind !== 'file') return compound.hasPage ? [fileSplitPage(compound, settings)] : [];
    const labels = labelsFor(compound);

    return compound.members.filter((member) => member.documented).map((member) => {
        const headings = [];
        const parts = [
            `<div class="lapi-meta">${
                `<span class="lapi-badge lapi-badge--${escapeHtml(member.kind)}">`
                + `${escapeHtml(labels.kind(member.kind))}</span>`
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
            slug: member.pageSlug,
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
    const anonymous = [];
    for (const file of xmlFilesIn(xmlDir)) {
        const compound = parseCompound(join(xmlDir, file), context);
        if (!compound || !DOCUMENTED_KINDS.has(compound.kind)) continue;

        const reason = exclusionReason(compound);
        if (reason) {
            if (reason === 'anonymous') anonymous.push(compound);
            else onSkip(compound.name, reason);
            continue;
        }

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
    for (const compound of published) assignPageSlugs(compound, split);

    const anonymousIndex = indexAnonymousTypes(anonymous);
    for (const compound of published) expandAnonymousTypes(compound, anonymousIndex);

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
        else if (compound.hasPage) pages.push(fileSplitPage(compound, settings));
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

/* ------------------------------------------------------------- page layout */

/**
 * Files a compound — and, under the symbol split, each of its members —
 * under the group whose section of the sidebar it belongs in.
 *
 * The group is a real URL segment (`api/classes/ringbuffer/`), not a label
 * applied afterwards, because that is what makes Starlight's autogenerated
 * sidebar produce one titled section per kind instead of one alphabetical
 * run of everything there is. See api/groups.mjs.
 *
 * `hasPage` is decided here too, for the one case where a compound is worth
 * knowing about and not worth opening: a namespace holding no symbols of its
 * own. `liara` exists only to contain `liara::preview`, and its page was a
 * heading, a one-line brief and a table with a single row in it. It now
 * appears in the namespace tree on the section index, where the nesting is
 * the information, and has no page at all.
 */
function assignPageSlugs(compound, split) {
    compound.group = groupForCompound(compound.kind);
    compound.slug = `${compound.group}/${compound.slug}`;

    for (const member of compound.members) {
        member.pageSlug = `${groupForMember(member.kind)}/${member.slug}`;
    }

    compound.hasPage = compound.kind === 'namespace'
        ? compound.members.length > 0
        : !(split === 'symbol' && compound.kind === 'file');
}

/* ------------------------------------------------------- anonymous members */

/**
 * Indexes the anonymous aggregates by what declares them.
 *
 * Doxygen names one after the nearest *named* compound and the dotted path
 * of the members leading to it — `HardwareOverlay::[union].status`,
 * `HardwareOverlay::[struct].status.bits` — and that name is the only link
 * back to the field using it: the field's own `<type>` carries the invented
 * `@…` name and no refid at all.
 */
function indexAnonymousTypes(compounds) {
    const index = new Map();
    for (const compound of compounds) {
        const owner = anonymousOwner(compound.name);
        if (!owner) continue;
        index.set(`${owner.parent} ${owner.path.join('.')}`, compound);
    }
    return index;
}

/** How deep an anonymous aggregate may nest before its declaration stops
 *  being worth reading inline. Three levels is already unusual C++. */
const ANONYMOUS_MAX_DEPTH = 4;

/**
 * Attaches the body of every anonymous aggregate to the field that has one.
 *
 * Without this a field declared with one is a dead end twice over: its
 * declaration prints the invented name — the
 * `union liara::preview::HardwareOverlay::@2301540030241…` a reader was
 * being shown — and the members it actually holds live on a page that was,
 * correctly, never generated. With it, `union { … } status` carries its own
 * fields and render.mjs writes them out beneath it.
 *
 * @param {object} compound The aggregate being expanded, mutated in place.
 * @param {Map}    index    From indexAnonymousTypes.
 * @param {string[]} path   Member names from the named compound down to here.
 */
function expandAnonymousTypes(compound, index, path = [], depth = 0) {
    if (depth > ANONYMOUS_MAX_DEPTH) return;
    const root = compound.anonymousRoot ?? compound.name;

    for (const member of compound.members) {
        const here = [...path, member.name];
        const inner = index.get(`${root} ${here.join('.')}`);
        if (!inner) continue;

        inner.anonymousRoot = root;
        inner.members = inner.members.filter(isPublishedMember);
        assignMemberSlugs(inner);
        expandAnonymousTypes(inner, index, here, depth + 1);

        member.anonymousType = { kind: inner.kind, members: inner.members };
    }
}

/* ------------------------------------------------------------- index page */

/**
 * How the compounds are grouped on the section index, in reading order.
 *
 * The same division as the sidebar's — see api/groups.mjs — because they are
 * two views of one structure and a reader who learns the shape from either
 * should recognise it in the other. Namespaces are the exception: a flat
 * table of them says nothing a sidebar does not already say, while the
 * nesting is most of what a namespace *is*, so they get a tree instead.
 */
const INDEX_GROUPS = [
    { title: 'Headers', kinds: ['file'] },
    { title: 'Namespaces', kinds: ['namespace'], layout: 'tree' },
    { title: 'Classes and structs', kinds: ['struct', 'union', 'class', 'interface'] },
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

        if (group.layout === 'tree') {
            parts.push(namespaceTree(namespaceNodes(members, { apiBase, pageSlugs })));
            continue;
        }

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

/**
 * The namespaces, as a tree of nodes ready to render.
 *
 * Built from the qualified names rather than from Doxygen's `innernamespace`
 * links, because a namespace that was filtered out — `detail`, or one whose
 * only content was excluded — must not take its children with it: the tree
 * grows an unlabelled level for it instead, so `a::detail::Thing` still
 * appears under `a`. Each node carries the last segment of its name, since
 * repeating the full path at every level is what made the flat list useless.
 */
function namespaceNodes(namespaces, { apiBase, pageSlugs }) {
    const root = { children: new Map() };

    for (const compound of namespaces) {
        let node = root;
        for (const segment of compound.name.split('::')) {
            if (!node.children.has(segment)) {
                node.children.set(segment, { label: segment, children: new Map() });
            }
            node = node.children.get(segment);
        }
        node.compound = compound;
        node.href = pageSlugs.has(compound.slug) ? `${apiBase}/${compound.slug}/` : null;
    }

    const collect = (node) => [...node.children.values()].map((child) => ({
        label: child.label,
        href: child.href ?? null,
        brief: child.compound ? textSummary(child.compound.brief, 110) : '',
        counts: child.compound ? contentCounts(child.compound) : '',
        children: collect(child),
    }));

    return collect(root);
}

/** `3 functions · 1 enum` — what is inside a compound, before opening it. */
function contentCounts(compound) {
    const isType = TYPE_KINDS.has(compound.kind);
    const labels = labelsFor(compound);
    const documented = compound.members.filter((member) => member.documented
        || (isType && member.kind === 'variable'));

    const count = (total, singular) => `<span class="lapi-count">${total}&nbsp;`
        + `${escapeHtml(total === 1 ? singular : `${singular}s`)}</span>`;

    const counts = orderedKinds(documented).map((kind) => count(
        documented.filter((member) => member.kind === kind).length, labels.kind(kind),
    ));
    const inner = compound.innerClasses.filter((entry) => entry.kind !== 'namespace').length;
    const nested = compound.innerClasses.length - inner;
    if (nested > 0) counts.unshift(count(nested, 'namespace'));
    if (inner > 0) counts.unshift(count(inner, 'type'));
    return counts.join('');
}

export { DOCUMENTED_KINDS, signatureOf };
