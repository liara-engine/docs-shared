/**
 * Liara Engine — Doxygen pages as Astro content.
 *
 * Starlight reads its documentation from a single `docs` collection. For
 * the API reference to be a section of the site rather than a neighbour of
 * it — same layout, same sidebar, same search index, same theme — its pages
 * have to live in that collection too, not in a parallel one.
 *
 * So this module supplies a content-layer loader that adds generated
 * entries to the collection Starlight already owns, and a `composeLoaders`
 * helper to run it alongside Starlight's own file-system loader.
 *
 * Entries are stored with `rendered.html` already populated. Astro's
 * content layer accepts pre-rendered output, which is what removes any
 * need for Markdown or MDX in between — see api/doxygen.mjs for why that
 * matters more than it sounds.
 *
 * In a consumer's src/content.config.ts:
 *
 *     import { defineCollection } from 'astro:content';
 *     import { docsLoader } from '@astrojs/starlight/loaders';
 *     import { docsSchema } from '@astrojs/starlight/schema';
 *     import { composeLoaders, doxygenLoader } from '@liara/starlight-preset/api';
 *
 *     export const collections = {
 *         docs: defineCollection({
 *             loader: composeLoaders(docsLoader(), doxygenLoader()),
 *             schema: docsSchema(),
 *         }),
 *     };
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildApiPages } from './pages.mjs';
import { createHighlight } from './highlight.mjs';

/** Where the API section lives in the URL space. Authored prose and
 *  generated reference are kept apart because generated slugs churn when
 *  the code is refactored and must not be able to shadow a hand-written
 *  page whose URL is meant to stay linkable. */
const API_DIRECTORY = 'api';

const DEFAULT_XML_DIR = 'build/xml/xml';

/**
 * Runs several content-layer loaders against one collection, in order.
 *
 * Astro allows a collection exactly one loader, but a collection may be
 * populated from more than one source. Order is significant: a loader that
 * clears the store must run before any loader that adds to it, so the
 * file-system loader goes first and generated entries are appended.
 *
 * @param {...object} loaders Loader objects, in the order they should run.
 * @returns {object} A single loader delegating to each in turn.
 */
export function composeLoaders(...loaders) {
    const present = loaders.filter(Boolean);
    return {
        name: 'liara-composed-loader',
        async load(context) {
            for (const loader of present) {
                await loader.load(context);
            }
        },
        // Schema resolution falls to the first loader that declares one;
        // in practice that is Starlight's, and the generated entries are
        // validated against it like any other.
        schema: present.find((loader) => loader.schema)?.schema,
    };
}

/**
 * Builds a content-layer loader over a Doxygen XML directory.
 *
 * @param {object} [options]
 * @param {string} [options.xmlDir='build/xml/xml'] Directory holding index.xml,
 *                 relative to the project root.
 * @param {'file'|'symbol'} [options.split='file'] Page granularity. `file`
 *                 suits a C surface, where a header is the unit a reader
 *                 already thinks in; `symbol` suits a large C++ surface, at
 *                 roughly two and a half times the file count.
 * @param {string} [options.sourceUrl] Base URL for "declared in" links, e.g.
 *                 `https://github.com/liara-engine/liara-interfaces/blob/main`.
 * @param {string} [options.label='API reference'] Title of the section index.
 * @param {string[]} [options.exclude] Glob patterns replacing the default set
 *                 of generated headers and implementation directories — see
 *                 api/filter.mjs. A module rarely needs this: `@internal` in a
 *                 header's `@file` block travels with the code, and a
 *                 Doxyfile's own `EXCLUDE_PATTERNS` covers the rest.
 * @param {boolean} [options.required=true] Whether a missing XML directory is
 *                 an error. Left true by default: a module configured for an
 *                 API reference that silently ships without one is the kind of
 *                 drift that only surfaces when a reader goes looking.
 * @returns {object} An Astro content-layer loader.
 */
export function doxygenLoader(options = {}) {
    const {
        xmlDir = DEFAULT_XML_DIR,
        split = 'file',
        sourceUrl,
        label = 'API reference',
        exclude,
        required = true,
    } = options;

    return {
        name: 'liara-doxygen-loader',

        async load({ store, logger, parseData, generateDigest, watcher }) {
            const directory = resolve(process.cwd(), xmlDir);

            if (!existsSync(directory)) {
                const message = `Doxygen XML not found at ${xmlDir}. `
                    + 'Run Doxygen with GENERATE_XML=YES before building the site.';
                if (required) throw new Error(message);
                logger.warn(message);
                return;
            }

            // `import.meta.env.BASE_URL` is not available to a loader, so the
            // deployment prefix is reconstructed the same way the preset does.
            const version = process.env.LIARA_DOCS_VERSION || 'dev';
            const repo = process.env.LIARA_DOCS_REPO || '';
            const apiBase = repo
                ? `/${repo}/${version}/${API_DIRECTORY}`
                : `/${API_DIRECTORY}`;

            const highlight = await createHighlight(split === 'symbol' ? 'cpp' : 'c');

            // What was left out is worth saying out loud. A header missing
            // from the reference is otherwise indistinguishable from a header
            // the generator failed on, and the difference matters to whoever
            // wonders where their page went.
            const skipped = [];
            const pages = buildApiPages(directory, {
                split, apiBase, sourceUrl, highlight, exclude,
                onSkip: (name, reason) => skipped.push(`${name} (${reason})`),
            });

            for (const [position, page] of pages.entries()) {
                const id = `${API_DIRECTORY}/${page.slug}`;
                const isIndex = page.slug === 'index';

                const data = await parseData({
                    id,
                    data: {
                        title: isIndex ? label : page.title,
                        description: page.description,
                        // Generated pages have no editable source. Pointing an
                        // "Edit this page" link at a header would invite someone
                        // to edit the wrong thing; pointing it at nothing at all
                        // would 404.
                        editUrl: false,
                        sidebar: {
                            // The section index leads; everything else follows
                            // in the alphabetical order Starlight applies.
                            order: isIndex ? 0 : position,
                        },
                    },
                });

                store.set({
                    id,
                    data,
                    body: '',
                    // Starlight derives a sidebar entry's route from
                    // `filePath`, relative to the collection root, and calls
                    // `.replace` on it unconditionally. A generated entry has
                    // no file on disk, so it declares the path it would have
                    // had. Nothing reads the file — `editUrl: false` above
                    // keeps anything from trying.
                    filePath: `src/content/docs/${id}.md`,
                    digest: generateDigest(page.html),
                    rendered: {
                        html: page.html,
                        metadata: {
                            headings: page.headings,
                            frontmatter: data,
                            imagePaths: [],
                        },
                    },
                });
            }

            logger.info(`Generated ${pages.length} API page(s) from ${xmlDir} (${split} split)`);
            if (skipped.length > 0) {
                logger.info(`Left out of the API reference: ${skipped.join(', ')}`);
            }

            // In dev, regenerate when Doxygen re-runs. Without this the API
            // section is frozen at the first build of the session, which looks
            // exactly like the generator having silently failed.
            watcher?.add(directory);
        },
    };
}

export { API_DIRECTORY };
export * from './pages.mjs';
export * from './render.mjs';
export * from './filter.mjs';
export * from './highlight.mjs';
export * from './doxygen.mjs';
