/**
 * Liara Engine — module cards.
 *
 * `modules-registry.json` (repository root) is the single source of truth
 * for a module's identity — key, repo, ABI/meta flags. It is also read
 * server-side, by tools/build-registry-index.py, to join in each module's
 * manifest at deploy time, and by the Starlight preset at build time (as
 * astro/registry.json, generated from this same file — see
 * astro/scripts/sync-registry.mjs — because the Docker image that bakes
 * every module's docs only ever `COPY`s astro/, never hub/).
 *
 * The registry carries no presentation — description, icon, card copy —
 * so that lives here, keyed by the same `key`.
 */
import registry from '../../../modules-registry.json';

const ICONS = {
    book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
    interfaces: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
    core: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    renderer: '<rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>',
    editor: '<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>',
    physics: '<circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/>',
};

/** Presentation for the modules that have a real repository and their own
 *  generated docs. Keyed by `modules-registry.json`'s `key`. */
const PRESENTATION = {
    interfaces: {
        title: 'Interfaces',
        description: 'The C ABI contracts shared by every module. Header-only.',
        icon: ICONS.interfaces,
    },
    core: {
        title: 'Core',
        description: 'ECS, math, asset management, logger, settings, application loop.',
        icon: ICONS.core,
    },
    renderer: {
        title: 'Renderer',
        description: 'The reference Vulkan implementation. Produces pixels from render packets.',
        icon: ICONS.renderer,
    },
};

const nonMeta = (registry.modules ?? []).filter((module) => !module.meta);
const missing = nonMeta.filter((module) => !PRESENTATION[module.key]);
if (missing.length > 0) {
    console.warn(
        `[hub] modules-registry.json lists module(s) with no card in `
        + `src/data/modules.js: ${missing.map((module) => module.key).join(', ')}`);
}

export const MODULE_CARDS = nonMeta
    .filter((module) => PRESENTATION[module.key])
    .map((module) => ({ ...PRESENTATION[module.key], key: module.key, repo: module.repo,
        href: `/${module.repo}/dev/`, version: 'dev' }));

export const EXTRA_CARDS = [
    { title: 'User guide', description: 'Tutorials, concepts, and how-tos for building with Liara.',
      icon: ICONS.book, href: '/user/dev/' },
];

export const PLANNED_CARDS = [
    { title: 'Editor', description: 'Visual scene editor. Planned for the v1.x cycle.', icon: ICONS.editor },
    { title: 'Physics', description: 'Collision and rigid body dynamics. Planned for the v1.x cycle.', icon: ICONS.physics },
];

export const ABI_REFERENCE_REPO = (registry.modules ?? []).find((module) => module.is_abi)?.repo ?? null;
