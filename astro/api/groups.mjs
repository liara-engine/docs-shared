/**
 * Liara Engine — how the API reference is divided up.
 */

/**
 * @typedef {object} ApiGroup
 * @property {string}   dir      URL segment, and the directory the loader files into.
 * @property {string}   label    Section title in the sidebar.
 * @property {string[]} compounds Doxygen compound kinds this group holds.
 * @property {string[]} members  Member kinds this group holds, under the symbol
 *                               split where a member is a page in its own right.
 */

/** @type {ReadonlyArray<ApiGroup>} */
export const API_GROUPS = Object.freeze([
    { dir: 'headers', label: 'Headers', compounds: ['file'], members: [] },
    { dir: 'namespaces', label: 'Namespaces', compounds: ['namespace'], members: [] },
    {
        dir: 'classes',
        label: 'Classes and structs',
        compounds: ['class', 'struct', 'union', 'interface'],
        members: [],
    },
    { dir: 'concepts', label: 'Concepts', compounds: ['concept'], members: [] },
    { dir: 'functions', label: 'Functions', compounds: [], members: ['function', 'friend'] },
    { dir: 'macros', label: 'Macros', compounds: [], members: ['define'] },
    { dir: 'types', label: 'Types', compounds: [], members: ['typedef', 'enum'] },
    {
        dir: 'variables',
        label: 'Variables',
        compounds: [],
        members: ['variable', 'property', 'signal', 'slot', 'event', 'service'],
    },
]);

const COMPOUND_GROUPS = new Map(
    API_GROUPS.flatMap((group) => group.compounds.map((kind) => [kind, group.dir])),
);

const MEMBER_GROUPS = new Map(
    API_GROUPS.flatMap((group) => group.members.map((kind) => [kind, group.dir])),
);

export function groupForCompound(kind) {
    return COMPOUND_GROUPS.get(kind) ?? API_FALLBACK_GROUP;
}

export function groupForMember(kind) {
    return MEMBER_GROUPS.get(kind) ?? API_FALLBACK_GROUP;
}

export default API_GROUPS;
