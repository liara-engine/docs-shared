import { defineCollection } from 'astro:content';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';
import { composeLoaders, doxygenLoader } from '@liara/starlight-preset/api';

const repo = process.env.LIARA_DOCS_REPO;
const sourceUrl = repo ? `https://github.com/liara-engine/${repo}/blob/main` : undefined;

export const collections = {
	docs: defineCollection({
		loader: composeLoaders(
			docsLoader(),
			doxygenLoader({
				sourceUrl,
				required: process.env.LIARA_DOCS_API === 'true',
			}),
		),
		schema: docsSchema(),
	}),
};
