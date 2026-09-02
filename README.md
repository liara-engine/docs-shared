---
title: About this module
description: The shared Astro/Starlight preset, the site tools, and the builder image behind every Liara Engine documentation site.
sidebar:
  order: 0
---

# docs-shared

> The shared Astro/Starlight preset, the site tools, and the builder image behind every Liara Engine documentation site.

`docs-shared` is the backbone of every documentation property in the Liara Engine project. It holds:

- **`astro/`** — `@liara/starlight-preset`, the shared Starlight configuration: design tokens and fonts, the module and version switchers, the version banner, the search entry point, and the loader that turns Doxygen XML into Starlight pages.
- **`tools/`** — the site tools that run against the deployed site rather than against a build: asset fingerprinting and garbage collection, the navigation index, the site-wide search index, and version retirement.
- **`hub/`** — the landing page at the site root.
- **`Dockerfile` + `build-docs.sh`** — the builder image (`ghcr.io/liara-engine/liara-documentation-builder`) that CI runs against every module. It bakes in everything above, so a module repository needs no Astro configuration of its own.

A module provides its own prose, its own headers and a `manifest.json`; everything else comes from here.

## Documentation

The full guide is published at
<https://liara-engine.liara-engine-documentation.workers.dev/docs-shared/latest/> and written in `docs/`:

| Page | For |
| --- | --- |
| [The documentation pipeline](https://liara-engine.liara-engine-documentation.workers.dev/docs-shared/latest/guides/documentation-pipeline/) | Changing how documentation looks or is built |
| [Authoring a module's documentation](https://liara-engine.liara-engine-documentation.workers.dev/docs-shared/latest/guides/authoring-a-module/) | Writing documentation for a module |
| [Search](https://liara-engine.liara-engine-documentation.workers.dev/docs-shared/latest/guides/search/) | How the site-wide search index works |
| [CI and deployment](https://liara-engine.liara-engine-documentation.workers.dev/docs-shared/latest/guides/ci-and-deployment/) | Operating the site |

Those links are absolute on purpose: this file is also published as a page of the site, under *About*, so a repository-relative link would resolve differently in the two places it is read.

## Working on it

There is no local build to babysit: open a pull request and a preview of `tests/fixtures/` — a synthetic module exercising the whole toolchain — is built with *your* image and published to a hidden URL, posted as a comment on the pull request.

To iterate on the preset alone, the hub is a plain Astro site:

```bash
npm --prefix hub ci && npm --prefix hub run dev
```

## License

MIT. See `LICENSE` at the root of this repository.
