/**
 * Liara Engine — shared Starlight preset.
 *
 * Every documentation site in the project is built from this one function,
 * so a module's astro.config.mjs contains only what is genuinely specific
 * to that module. Anything that should look or behave identically across
 * sites belongs here, not in the consumer.
 *
 * A module's config reduces to:
 *
 *     import { defineConfig } from 'astro/config';
 *     import starlight from '@astrojs/starlight';
 *     import { liaraDocs } from '@liara/starlight-preset';
 *
 *     export default defineConfig(liaraDocs({
 *         starlight,
 *         repo: 'liara-interfaces',
 *         title: 'Liara Interfaces',
 *         description: 'The C ABI contracts shared by every module.',
 *     }));
 *
 * Deployment path
 * ---------------
 * A built Astro site is not relocatable: `base` is baked into every emitted
 * URL. The deploy path therefore has to be known at build time, and it comes
 * from the environment rather than the config so that the same commit can be
 * built as a release (/<repo>/1.0.0/), as a dev snapshot (/<repo>/dev/) or as
 * a pull request preview (/<repo>/pr-42/) without editing a tracked file.
 *
 *     LIARA_DOCS_SITE     origin of the deployed site
 *     LIARA_DOCS_VERSION  version segment: `dev`, `1.2.3`, `pr-42`
 *     LIARA_ASSETS_PREFIX root path of the content-addressed asset store
 *
 * The defaults make `npm run dev` work with no environment at all.
 */

import mermaid from 'astro-mermaid';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_SITE = 'https://liara-engine.liara-engine-documentation.workers.dev';
const HERE = dirname(fileURLToPath(import.meta.url));

export const SECTIONS = Object.freeze({ about: 'about', guide: 'guides', api: 'api' });

/**
 * Reads the module registry, wherever a copy of it can be found.
 */
export function readRegistry() {
    const candidates = [
        resolve(HERE, 'registry.json'),
        resolve(HERE, '..', 'modules-registry.json'),
    ];
    for (const path of candidates) {
        try {
            return JSON.parse(readFileSync(path, 'utf-8'));
        } catch {
            // try the next candidate
        }
    }
    return { modules: [] };
}

/**
 * Reads the module manifest being built, if there is one.
 */
export function readManifest(cwd = process.cwd()) {
    try {
        return JSON.parse(readFileSync(resolve(cwd, 'manifest.json'), 'utf-8'));
    } catch {
        return null;
    }
}

export function sortVersions(labels) {
    return [...labels].sort((a, b) => {
        if (a === 'dev') return -1;
        if (b === 'dev') return 1;
        return b.localeCompare(a, undefined, { numeric: true });
    });
}

export function parseBase(base) {
    const [, repo = '', version = ''] = base.replace(/\/+$/, '').split('/');
    return { repo, version };
}

function requireString(value, name) {
    if (typeof value !== 'string' || value.length === 0) {
        throw new Error(`liaraDocs: \`${name}\` is required and must be a non-empty string.`);
    }
    return value;
}

/**
 * Builds the complete Astro configuration for one module's documentation.
 *
 * @param {object}  options
 * @param {Function} options.starlight  The `@astrojs/starlight` integration
 *                                      factory, imported by the consumer.
 * @param {string}  options.repo         GitHub repository name, e.g. `liara-core`.
 *                                       Also the first URL segment of the site.
 * @param {string}  options.title        Human-readable site title.
 * @param {string}  options.description  One-line description for metadata.
 * @param {boolean} [options.api=true]   Whether this module ships an API reference.
 * @param {Array}   [options.sidebar]    Extra sidebar entries appended after the
 *                                       Guide and API groups.
 * @param {object}  [options.overrides]  Escape hatch merged over the computed
 *                                       Starlight options. Reach for it rarely:
 *                                       anything used twice belongs in the preset.
 * @returns {object} An object to hand to `defineConfig`.
 */
export function liaraDocs(options = {}) {
    if (typeof options.starlight !== 'function') {
        throw new Error(
            'liaraDocs: `starlight` must be the @astrojs/starlight integration '
            + 'factory. Import it in your astro.config.mjs and pass it in.');
    }
    const repo = requireString(options.repo, 'repo');
    const title = requireString(options.title, 'title');
    const description = requireString(options.description, 'description');
    const hasApi = options.api !== false;

    const site = process.env.LIARA_DOCS_SITE || DEFAULT_SITE;
    const version = process.env.LIARA_DOCS_VERSION || 'dev';
    const base = `/${repo}/${version}`;

    // Astro hashes emitted assets by content, but writes them under `base`,
    // so two versions that produce byte-identical bundles still occupy two
    // paths. Pointing the prefix at a site-wide root collapses them onto one
    // path, which is what makes the content-addressed store of the hosting
    // layer effective. See tools/site-audit.py for the measurement.
    const assetsPrefix = process.env.LIARA_ASSETS_PREFIX || undefined;

    const sidebar = [
        {
            label: 'About',
            items: [{ autogenerate: { directory: SECTIONS.about } }],
        },
        {
            label: 'Guide',
            items: [{ autogenerate: { directory: SECTIONS.guide } }],
        },
        ...(hasApi ? [{
            label: 'API reference',
            items: [{ autogenerate: { directory: SECTIONS.api } }],
        }] : []),
        ...(options.sidebar ?? []),
    ];

    const starlightOptions = {
        title,
        description,
        disable404Route: true,
        customCss: [
            '@liara/starlight-preset/styles/fonts.css',
            '@liara/starlight-preset/styles/tokens.css',
            '@liara/starlight-preset/styles/theme.css',
            '@liara/starlight-preset/styles/hub.css',
        ],
        social: [{
            icon: 'github',
            label: 'GitHub',
            href: `https://github.com/liara-engine/${repo}`,
        }],
        editLink: {
            baseUrl: `https://github.com/liara-engine/${repo}/edit/main/docs/`,
        },
        components: {
            SiteTitle: '@liara/starlight-preset/components/SiteTitle.astro',
            Banner: '@liara/starlight-preset/components/VersionBanner.astro',
        },
        sidebar,
        pagination: true,
        lastUpdated: true,
        plugins: [],
        ...(options.overrides ?? {}),
    };

    return {
        site,
        base,
        trailingSlash: 'always',
        build: {
            format: 'directory',
            ...(assetsPrefix ? { assetsPrefix } : {}),
        },
        integrations: [
            mermaid({ theme: 'forest', autoTheme: true }),
            options.starlight(starlightOptions)
        ],
    };
}

export default liaraDocs;
