import { defineConfig } from 'astro/config';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

const assetsPrefix = process.env.LIARA_ASSETS_PREFIX || undefined;

const require = createRequire(import.meta.url);
const publicDir = resolve(
    dirname(require.resolve('@liara/starlight-preset/package.json')),
    'public',
);

export default defineConfig({
    publicDir,
    trailingSlash: 'always',
    build: {
        format: 'directory',
        ...(assetsPrefix ? { assetsPrefix } : {}),
    },
});
