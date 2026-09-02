import { defineConfig } from 'astro/config';

const assetsPrefix = process.env.LIARA_ASSETS_PREFIX || undefined;

export default defineConfig({
    trailingSlash: 'always',
    build: {
        format: 'directory',
        ...(assetsPrefix ? { assetsPrefix } : {}),
    },
});
