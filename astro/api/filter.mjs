/**
 * Liara Engine — what does not belong in a generated API reference.
 *
 * Doxygen is asked to read everything (`EXTRACT_ALL`), because the
 * alternative is a reference that silently omits whatever nobody remembered
 * to comment. The cost is that it also reports things that are not part of
 * a module's surface at all: the header CMake generates to hold one export
 * macro, the `std` namespace it picked up from an include, the
 * `LIARA_STATIC_ASSERT(…)` line it mistook for a function declaration.
 *
 * Three mechanisms, in the order a module should reach for them:
 *
 *   1. `@internal` in a file's `@file` block keeps that header out of the
 *      reference entirely; on a single symbol it keeps that symbol out.
 *      It travels with the code, which is the point — a header moved or
 *      renamed does not leave a stale pattern behind. It requires
 *      `INTERNAL_DOCS = YES`, which build-docs.sh forces so that the marker
 *      reaches the XML instead of being stripped from it.
 *
 *   2. The default patterns below, for the generated headers no one writes
 *      by hand and nobody wants to read.
 *
 *   3. `EXCLUDE_PATTERNS` in the module's own Doxyfile, for anything else.
 *      Doxygen already has this and it works: nothing reaches the loader.
 *
 * On top of those, a compound with nothing documented in it is dropped. A
 * page that lists only symbols nobody described is not a reference page —
 * it is the absence of one, published.
 */

/**
 * Headers a build system wrote, not a person.
 *
 * `generate_export_header` in CMake produces `<target>_export.h` holding
 * the visibility macros and nothing else, and every module in the project
 * has one. A directory named `detail`, `internal` or `impl` is the C and
 * C++ convention for "not part of the interface" and is treated the same
 * way. Anything else a module wants gone belongs in its own Doxyfile, under
 * `EXCLUDE_PATTERNS`, or behind an `@internal`.
 */
export const DEFAULT_EXCLUDE_PATTERNS = Object.freeze([
    '**/*_export.h',
    '**/*_export.hpp',
    '**/*_export.hxx',
    '**/detail/**',
    '**/internal/**',
    '**/impl/**',
]);

/**
 * Namespaces that belong to somebody else.
 *
 * `BUILTIN_STL_SUPPORT` makes Doxygen emit a `std` compound whose entire
 * documentation is the words "STL namespace." A page saying that is worse
 * than no page, and the same is true of the implementation namespaces a
 * standard library drags in.
 */
const FOREIGN_NAMESPACE = /^(?:std|__[A-Za-z0-9_]*|_[A-Z])(?:::|$)/;

/** The last segment of a namespace path that marks it as implementation. */
const PRIVATE_NAMESPACE_SEGMENT = /(?:^|::)(?:detail|details|internal|impl|priv|private_)$/;

/**
 * Compiles a glob to a regular expression.
 *
 * The vocabulary is the one a `.gitignore` or an `EXCLUDE_PATTERNS` uses —
 * `**` across separators, `*` and `?` within one segment — and nothing
 * more. Bringing in a matcher for this would be a dependency in the builder
 * image for twenty lines of code.
 */
export function globToRegExp(pattern) {
    let source = '';
    for (let i = 0; i < pattern.length; i += 1) {
        const character = pattern[i];
        if (character === '*') {
            if (pattern[i + 1] === '*') {
                // `**/` also matches zero directories, so `**/x.h` matches `x.h`.
                if (pattern[i + 2] === '/') { source += '(?:.*/)?'; i += 2; } else { source += '.*'; i += 1; }
            } else {
                source += '[^/]*';
            }
        } else if (character === '?') {
            source += '[^/]';
        } else {
            source += character.replace(/[.+^${}()|[\]\\]/g, '\\$&');
        }
    }
    return new RegExp(`^${source}$`, 'i');
}

/**
 * Builds the predicate that decides whether a compound is published.
 *
 * @param {object}   [options]
 * @param {string[]} [options.exclude] Glob patterns replacing the defaults.
 * @returns {(compound: object) => string|null} The reason it was excluded,
 *          or null when it stays.
 */
export function createCompoundFilter({ exclude = DEFAULT_EXCLUDE_PATTERNS } = {}) {
    const patterns = exclude.map(globToRegExp);

    return function exclusionReason(compound) {
        if (compound.internal) return 'marked @internal';
        if (compound.anonymous) return 'anonymous';

        if (compound.kind === 'namespace') {
            if (FOREIGN_NAMESPACE.test(compound.name)) return 'foreign namespace';
            if (PRIVATE_NAMESPACE_SEGMENT.test(compound.name)) return 'implementation namespace';
        }

        const path = compound.kind === 'file' ? (compound.location?.file || compound.name) : null;
        if (path && patterns.some((pattern) => pattern.test(path) || pattern.test(compound.name))) {
            return 'excluded by pattern';
        }

        return null;
    };
}

/**
 * Whether a member survives into the reference at all.
 *
 * This is not the documented/undocumented split — an undocumented symbol is
 * still part of the surface and is listed, quietly, at the foot of its page.
 * This is only for what was never a symbol: `@internal` markers and the
 * macro invocations Doxygen reads as declarations.
 */
export function isPublishedMember(member) {
    return !member.internal && !member.macroArtefact;
}

/**
 * Whether a compound is worth a page once its members have been filtered.
 *
 * A header describing itself earns a page even with nothing documented
 * inside it; a header with neither a description nor one documented symbol
 * nor a type declared in it does not. That single rule is what removes the
 * `<module>_export.h` pages, with or without the patterns above.
 */
export function isWorthPublishing(compound) {
    return Boolean(
        compound.brief
        || compound.detailed
        || compound.innerClasses.length > 0
        || compound.members.some((member) => member.documented),
    );
}
