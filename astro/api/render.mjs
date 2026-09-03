/**
 * Liara Engine — the markup a generated API page is made of.
 *
 * Every piece here is a plain string-returning function, deliberately: the
 * pages are built inside a content-layer loader, which runs before Astro has
 * a component renderer to offer, so `.astro` files are not available and
 * would not help — the output has to be an HTML string either way.
 *
 * The layout follows what a reference reader actually does. They arrive
 * looking for one symbol, so every page opens with a synopsis — the whole
 * header on one screen, one row per symbol — and each symbol below it is a
 * self-contained card: what it is, how it is declared, what it does, then
 * its parameters, its result and its contract, always in that order and
 * always under the same labels. The previous shape was a flat run of
 * headings, paragraphs and unlabelled tables, which is readable only if you
 * already know what you are looking at.
 *
 * The classes are all `lapi-` prefixed and styled by styles/api.css. None
 * of them are Starlight's, and nothing here overrides a Starlight selector:
 * because Starlight puts its content styles in a cascade layer, the
 * unlayered rules in api.css win without a specificity fight.
 */

import {
    ANONYMOUS_TYPE_LABEL, COMPOUND_KIND_LABELS, MEMBER_KIND_LABELS, escapeHtml,
    signatureOf, stripAnonymousNames, stripOuterParagraph,
} from './doxygen.mjs';

const PLAIN_LABELS = { kind: (kind) => MEMBER_KIND_LABELS[kind] ?? kind };

/* -------------------------------------------------------------- primitives */

/** A coloured chip naming what a thing is. */
export function badge(kind, label = kind) {
    return `<span class="lapi-badge lapi-badge--${escapeHtml(kind)}">${escapeHtml(label)}</span>`;
}

/** The qualifiers on a declaration: `static`, `inline`, `constexpr`… */
export function flagChips(flags = []) {
    if (flags.length === 0) return '';
    return `<span class="lapi-flags">${
        flags.map((flag) => `<span class="lapi-flag">${escapeHtml(flag)}</span>`).join('')
    }</span>`;
}

/** A labelled section inside a member card. */
export function block(title, body, modifier = '') {
    if (!body) return '';
    const suffix = modifier ? ` lapi-block--${escapeHtml(modifier)}` : '';
    return `<div class="lapi-block${suffix}">`
        + `<h4 class="lapi-block__title">${escapeHtml(title)}</h4>${body}</div>`;
}

/** A table that may be wider than the page. */
export function scrollable(html) {
    return `<div class="lapi-scroll">${html}</div>`;
}

function cell(html) {
    return stripOuterParagraph(String(html ?? '').trim());
}

/**
 * Renders a table, dropping any column that is empty in every row.
 *
 * Doxygen's model is optional almost everywhere — a macro's parameters have
 * no types, an enum's enumerators usually have no explicit values — and a
 * column of blanks with a heading over it is exactly the kind of thing that
 * makes a generated page hard to read.
 *
 * @param {string}   className
 * @param {string[]} headers
 * @param {string[][]} rows   Cell HTML, one array per row, aligned to headers.
 * @param {string[]} [ids]    Optional element id per row.
 */
export function table(className, headers, rows, ids = []) {
    if (rows.length === 0) return '';
    const keep = headers.map((_, column) => rows.some((row) => String(row[column] ?? '').trim() !== ''));
    if (!keep.some(Boolean)) return '';

    const head = headers.filter((_, i) => keep[i])
        .map((header) => `<th>${escapeHtml(header)}</th>`).join('');
    const body = rows.map((row, index) => {
        const id = ids[index] ? ` id="${escapeHtml(ids[index])}"` : '';
        return `<tr${id}>${row.filter((_, i) => keep[i]).map((value) => `<td>${value ?? ''}</td>`).join('')}</tr>`;
    }).join('');

    return scrollable(`<table class="lapi-table ${className}"><thead><tr>${head}</tr></thead>`
        + `<tbody>${body}</tbody></table>`);
}

/* ----------------------------------------------------------------- pieces */

export function signatureBlock(member, highlight) {
    return `<div class="lapi-signature">${highlight(stripAnonymousNames(signatureOf(member)))}</div>`;
}

export function parameterTable(member) {
    const rows = member.parameters.map((parameter) => {
        const direction = parameter.direction
            ? ` <span class="lapi-dir">${escapeHtml(parameter.direction)}</span>`
            : '';
        const name = parameter.name
            ? `<code class="lapi-param-name">${escapeHtml(parameter.name)}</code>${direction}`
            : direction;
        const type = parameter.type ? `<span class="lapi-type">${parameter.type}</span>` : '';
        const fallback = parameter.defaultValue
            ? `<span class="lapi-default">= ${escapeHtml(parameter.defaultValue)}</span>`
            : '';
        return [name, `${type}${fallback ? ` ${fallback}` : ''}`, cell(parameter.description)];
    });
    // A row that names a parameter and says nothing else repeats the
    // signature directly above it. That is every function-like macro, whose
    // parameters have no types for Doxygen to report.
    const informative = member.parameters.some((parameter) => parameter.description || parameter.type);
    return informative ? table('lapi-params', ['Name', 'Type', 'Description'], rows) : '';
}

export function templateParamTable(member) {
    const rows = (member.templateParams ?? []).map((parameter) => [
        `<code class="lapi-param-name">${escapeHtml(parameter.name || parameter.type)}</code>`,
        parameter.defaultValue ? `<span class="lapi-type">= ${escapeHtml(parameter.defaultValue)}</span>` : '',
        '',
    ]);
    return table('lapi-params', ['Parameter', 'Default', 'Description'], rows);
}

/**
 * The result of a call: the prose from `@return`, then the codes from
 * `@retval`, under one heading. They answer the same question and used to
 * be either split apart or, for `@retval`, dropped entirely.
 */
export function returnsBlock(member) {
    if (!member.returns && member.retvals.length === 0) return '';

    const type = member.type && member.kind === 'function'
        ? `<p class="lapi-returns__type"><span class="lapi-type">${member.type}</span></p>`
        : '';
    const prose = member.returns ? `<div class="lapi-returns__prose">${member.returns}</div>` : '';
    const rows = member.retvals.map((retval) => [
        `<code>${escapeHtml(retval.name)}</code>`,
        cell(retval.description),
    ]);
    return block('Returns', type + prose + table('lapi-retvals', ['Value', 'Meaning'], rows));
}

export function exceptionTable(member) {
    const rows = member.exceptions.map((exception) => [
        `<code>${escapeHtml(exception.name)}</code>`,
        cell(exception.description),
    ]);
    return block('Throws', table('lapi-retvals', ['Exception', 'When'], rows));
}

export function enumTable(member) {
    const values = member.values ?? [];
    const rows = values.map((value) => [
        `<code>${escapeHtml(value.name)}</code>`,
        value.initializer ? `<code>${escapeHtml(value.initializer.replace(/^=\s*/, ''))}</code>` : '',
        cell(value.brief || value.detailed),
    ]);
    return block('Enumerators', table(
        'lapi-enum', ['Enumerator', 'Value', 'Description'], rows, values.map((value) => value.slug),
    ));
}

export function sourceLink(location, sourceUrl) {
    if (!location?.file) return '';
    const label = `${location.file}${location.line ? `:${location.line}` : ''}`;
    if (!sourceUrl) return `<p class="lapi-source">${escapeHtml(label)}</p>`;
    const href = `${sourceUrl}/${location.file}${location.line ? `#L${location.line}` : ''}`;
    return `<p class="lapi-source"><a href="${escapeHtml(href)}">${escapeHtml(label)}</a></p>`;
}

/**
 * How to include a header.
 *
 * The first thing a reader needs from a C header page and the one thing
 * Doxygen never states. The include root is not in the XML either, so it is
 * recovered from the path — everything after the last `include/` segment,
 * which is the layout every module in the project uses. No `include/` in
 * the path means no guess worth printing.
 */
export function includeLine(compound) {
    const path = compound.location?.file;
    if (compound.kind !== 'file' || !path) return '';
    const match = /(?:^|\/)include\/(.+)$/.exec(path);
    if (!match) return '';
    return `<div class="lapi-include"><code>#include &lt;${escapeHtml(match[1])}&gt;</code></div>`;
}

/* ----------------------------------------------------------------- fields */

/**
 * The fields of an aggregate, as one table.
 *
 * A struct's fields are read together — the reader is looking at a layout,
 * not at three independent symbols — and a card apiece turns four lines of
 * C into a page of scrolling. Each row carries the field's anchor, so a
 * cross-reference still lands on the field it names.
 */
export function fieldTable(members) {
    const rows = [];
    const ids = [];

    /**
     * A field's own row, then — where its type is an anonymous aggregate —
     * the rows of what is inside it, indented and named by the path a caller
     * would actually write. `status.bits.is_active` is the whole point: the
     * members of an unnamed union have no page of their own (there is no
     * name to give one), so if they are not here they are nowhere.
     */
    const emit = (member, path = [], depth = 0) => {
        const prefix = path.length > 0
            ? `<span class="lapi-field-path">${escapeHtml(path.join('.'))}.</span>`
            : '';
        rows.push([
            `<code class="lapi-param-name">${prefix}${escapeHtml(member.name)}</code>`
            // A module that extracts private members says so on every row that
            // is one, rather than presenting them as part of the interface.
            + flagChips(member.flags.filter((flag) => flag === 'private' || flag === 'protected')),
            fieldType(member),
            cell([member.brief, member.detailed].filter(Boolean).join(' ')),
        ]);
        // Only the top level owns an anchor: a cross-reference names a field
        // of the aggregate, and the nested rows are reached through it.
        ids.push(depth === 0 ? member.slug : '');

        for (const inner of member.anonymousType?.members ?? []) {
            emit(inner, [...path, member.name], depth + 1);
        }
    };

    for (const member of members) emit(member);
    return table('lapi-fields', ['Field', 'Type', 'Description'], rows, ids);
}

/** A field's type, with any invented name for an anonymous aggregate
 *  replaced by what the source actually said. */
function fieldType(member) {
    const width = member.bitfield
        ? `<span class="lapi-bitfield"> :${escapeHtml(member.bitfield.trim())}</span>`
        : '';
    if (member.anonymousType) {
        return `<span class="lapi-type">${escapeHtml(member.anonymousType.kind)} `
            + `${escapeHtml(ANONYMOUS_TYPE_LABEL)}</span>${width}`;
    }
    if (!member.type) return width;
    return `<span class="lapi-type">${stripAnonymousNames(member.type)}`
        + `${escapeHtml(member.args)}</span>${width}`;
}

/**
 * The aggregate, written out the way it appears in the header.
 *
 * Doxygen never emits the declaration itself, only its parts, and reading
 * a layout one table row at a time is not the same as seeing it. Rebuilding
 * it from `type` + `name` + `args` is exactly how Doxygen renders a
 * declaration elsewhere, so arrays and function pointers — where the name
 * sits in the middle of the type — come out right.
 *
 * Emitted only for a pure aggregate: every member a field, nothing hidden.
 * A C++ class with methods and access specifiers cannot be reconstructed
 * honestly from what the XML says, and a declaration that is subtly
 * incomplete is worse than none.
 */
export function aggregateDeclaration(compound, highlight) {
    const fields = compound.members;
    if (fields.length === 0 || fields.some((member) => member.kind !== 'variable')) return '';
    if (!['struct', 'union'].includes(compound.kind)) return '';

    const name = compound.name.split('::').pop();
    return `<div class="lapi-signature">${
        highlight(`${compound.kind} ${name} {\n${aggregateBody(fields)}\n};`)}</div>`;
}

/**
 * The fields of an aggregate as source, one per line.
 *
 * A field whose type is an anonymous aggregate is written out the way it was
 * declared — the nested `union { … } status;` — rather than with the name
 * Doxygen invented for it. That name is not a type anybody can write down:
 * `union liara::preview::HardwareOverlay::@2301540030241…` was what this
 * declaration used to say, and it is worse than useless in a block whose
 * whole purpose is to be readable as C++.
 */
function aggregateBody(fields, indent = '    ') {
    return fields.map((field) => {
        const width = field.bitfield ? ` :${field.bitfield.trim()}` : '';
        const inner = field.anonymousType;
        if (!inner) {
            return `${indent}${stripAnonymousNames(field.typeText)} ${field.name}${field.args}${width};`;
        }
        return `${indent}${inner.kind} {\n`
            + `${aggregateBody(inner.members, `${indent}    `)}\n`
            + `${indent}} ${field.name}${field.args}${width};`;
    }).join('\n');
}

/* ------------------------------------------------------------ member cards */

/**
 * One symbol, as a self-contained card.
 *
 * The heading carries the id, not the card: Starlight's table of contents
 * looks for `h2`/`h3` elements with an id and would otherwise scroll to a
 * heading it cannot find.
 */
export function memberCard(member, { sourceUrl, highlight, labels = PLAIN_LABELS }) {
    const label = labels.kind(member.kind);
    const prose = [member.brief, member.detailed].filter(Boolean).join('\n');

    const body = [
        signatureBlock(member, highlight),
        prose ? `<div class="lapi-prose">${prose}</div>` : '',
        block('Template parameters', templateParamTable(member)),
        block('Parameters', parameterTable(member)),
        returnsBlock(member),
        exceptionTable(member),
        enumTable(member),
        sourceLink(member.location, sourceUrl),
    ].filter(Boolean).join('\n');

    return `<article class="lapi-member lapi-member--${escapeHtml(member.kind)}">`
        + `<h3 id="${escapeHtml(member.slug)}" class="lapi-member__title">`
        + `${badge(member.kind, label)}<code>${escapeHtml(member.name)}</code>`
        + `${flagChips(member.flags)}`
        + `<a class="lapi-permalink" href="#${escapeHtml(member.slug)}" aria-label="Link to ${escapeHtml(member.name)}">#</a>`
        + `</h3>${body}</article>`;
}

/* --------------------------------------------------------- namespace tree */

/**
 * The namespaces, nested the way they are in the code.
 *
 * A flat table of `liara`, `liara::preview`, `liara::preview::detail` states
 * the same containment three times and shows it none. The tree states it
 * once, in the shape, and each level names only its own segment — which is
 * also how a reader thinks about `preview` when they are already inside
 * `liara`. A node without a page is still a node: it is the namespace whose
 * only contents are other namespaces, and its nesting is exactly what a
 * reader came here for.
 *
 * @param {Array<{label, href, brief, counts, children}>} nodes
 */
export function namespaceTree(nodes) {
    if (!nodes || nodes.length === 0) return '';

    const item = (node) => {
        const name = node.href
            ? `<a class="lapi-tree__name" href="${escapeHtml(node.href)}"><code>${escapeHtml(node.label)}</code></a>`
            : `<span class="lapi-tree__name lapi-tree__name--plain"><code>${escapeHtml(node.label)}</code></span>`;
        const brief = node.brief ? `<span class="lapi-tree__brief">${escapeHtml(node.brief)}</span>` : '';
        const counts = node.counts ? `<span class="lapi-tree__counts">${node.counts}</span>` : '';
        return `<li class="lapi-tree__item"><div class="lapi-tree__row">${name}${brief}${counts}</div>`
            + `${namespaceTree(node.children)}</li>`;
    };

    return `<ul class="lapi-tree">${nodes.map(item).join('')}</ul>`;
}

/* -------------------------------------------------------------- synopsis */

/**
 * The whole compound on one screen.
 *
 * One row per symbol — what it is, what it is called, what it does — so the
 * reader can find the one they came for without scrolling through the
 * details of the ones they did not. This is the part Doxygen gets right
 * with its member declaration tables and the previous layout had no
 * equivalent of.
 */
export function synopsisTable(entries) {
    const rows = entries.map((entry) => [
        badge(entry.kind, entry.label),
        // A namespace with nothing of its own has no page to link to; it is
        // still listed, because a header that declares everything inside one
        // would otherwise say nothing at all about what it contains.
        (entry.href
            ? `<a href="${escapeHtml(entry.href)}"><code>${escapeHtml(entry.name)}</code></a>`
            : `<code>${escapeHtml(entry.name)}</code>`)
        + (entry.suffix ? `<span class="lapi-synopsis__suffix">${escapeHtml(entry.suffix)}</span>` : ''),
        cell(entry.brief),
    ]);
    return table('lapi-synopsis', ['', 'Name', 'Summary'], rows);
}

/** The argument list of a function, shortened for a synopsis row. */
export function shortArguments(member) {
    if (member.kind !== 'function' && member.kind !== 'define') return '';
    if (member.parameters.length === 0) return member.kind === 'function' ? '()' : '';
    return `(${member.parameters.map((parameter) => parameter.name || parameter.type.replace(/<[^>]*>/g, '')).join(', ')})`;
}

/* ---------------------------------------------------------- undocumented */

/**
 * The symbols nobody described.
 *
 * They are part of the surface, so hiding them would misrepresent the
 * module; they carry no information, so putting them among the documented
 * ones buries what does. Collapsed at the foot of the page, they stay
 * findable — by search, by a cross-reference landing on the row's id, or by
 * opening the disclosure — without costing anything to a reader who is not
 * looking for them.
 */
export function undocumentedBlock(members, labels = PLAIN_LABELS) {
    if (members.length === 0) return '';
    const rows = members.map((member) => [
        badge(member.kind, labels.kind(member.kind)),
        `<code>${escapeHtml(member.name)}</code>`,
        `<code class="lapi-undocumented__signature">${
            escapeHtml(stripAnonymousNames(signatureOf(member)).replace(/\s+/g, ' '))}</code>`,
    ]);
    const count = members.length === 1 ? '1 symbol' : `${members.length} symbols`;
    return `<details class="lapi-undocumented">`
        + `<summary>Also declared here — ${escapeHtml(count)} without documentation</summary>`
        + table('lapi-undocumented__table', ['', 'Name', 'Declaration'], rows, members.map((m) => m.slug))
        + '</details>';
}

/* ------------------------------------------------------------ page header */

/**
 * The band above the prose: what kind of thing this page documents, and
 * where it lives in the source tree.
 */
export function compoundHeader(compound, sourceUrl) {
    const kindLabel = COMPOUND_KIND_LABELS[compound.kind] ?? compound.kind;
    const path = compound.location?.file;
    const location = path && sourceUrl
        ? `<a class="lapi-meta__path" href="${escapeHtml(`${sourceUrl}/${path}`)}"><code>${escapeHtml(path)}</code></a>`
        : path ? `<span class="lapi-meta__path"><code>${escapeHtml(path)}</code></span>` : '';

    return `<div class="lapi-meta">${badge(compound.kind, kindLabel)}${location}</div>`;
}

export { COMPOUND_KIND_LABELS, MEMBER_KIND_LABELS };
