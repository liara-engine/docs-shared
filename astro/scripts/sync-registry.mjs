#!/usr/bin/env node

import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, '..', '..', 'modules-registry.json');
const target = resolve(here, '..', 'registry.json');

if (!existsSync(source)) {
    console.log(`[registry] ${source} not found — leaving ${target} as-is `
        + '(expected when building from the Docker image, which places its own copy)');
    process.exit(0);
}

JSON.parse(readFileSync(source, 'utf-8'));

copyFileSync(source, target);
console.log(`[registry] synced ${target} from ${source}`);
