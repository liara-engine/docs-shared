/**
 * Liara Engine — what a page's trail says.
 */

import { API_GROUPS } from '../api/groups.mjs';
import { SECTIONS } from '../index.mjs';

export const SECTION_LABELS = Object.freeze({
    [SECTIONS.about]: 'About',
    [SECTIONS.guide]: 'Guide',
    [SECTIONS.api]: 'API reference',
});

const API_GROUP_LABELS = new Map(API_GROUPS.map((group) => [group.dir, group.label]));

function firstLink(entries) {
    for (const entry of entries ?? []) {
        if (entry.type === 'link') return entry.href;
        const found = firstLink(entry.entries);
        if (found) return found;
    }
    return undefined;
}

function sectionHref(sidebar, label) {
    const group = (sidebar ?? []).find((entry) => entry.type === 'group' && entry.label === label);
    return group ? firstLink(group.entries) : undefined;
}

/**
 * The trail for one page.
 *
 * @param {object} options
 * @param {string} options.base      Astro's `BASE_URL`, with its trailing slash.
 * @param {string} options.entryId   The route's collection id, e.g. `api/classes/x`.
 * @param {string} options.module    Human-readable module name.
 * @param {string} options.version   Version segment being read.
 * @param {Array}  [options.sidebar] `Astro.locals.starlightRoute.sidebar`.
 * @param {boolean} [options.isRoot] Whether this *is* the module's landing
 *                                   page, rather than a page below it.
 * @returns {Array<{label, href?, badge?, home?, current?}>}
 */
export function breadcrumbTrail({ base, entryId, module, version, sidebar, isRoot = false }) {
    const trail = [
        { label: 'Documentation hub', href: '/', home: true },
        { label: module, href: isRoot ? undefined : base, badge: version, current: isRoot },
    ];

    const [section, group] = String(entryId ?? '').split('/');
    const label = SECTION_LABELS[section];
    if (!label) return trail;

    trail.push({ label, href: sectionHref(sidebar, label) });

    if (section === SECTIONS.api && API_GROUP_LABELS.has(group)) {
        trail.push({ label: API_GROUP_LABELS.get(group) });
    }
    return trail;
}
