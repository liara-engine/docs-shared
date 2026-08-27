# The documentation pipeline

> The documentation of the documentation. Yes, it is a little meta.

This page explains how Liara Engine's documentation is produced, versioned, and served — every repository, tool, and moving part involved, and how they fit together. If you are touching templates, CI, or the hosting layer, start here.

---

## Table of contents

- [1. The big picture](#1-the-big-picture)
- [2. The repositories and their roles](#2-the-repositories-and-their-roles)
- [3. Baked vs runtime](#31-baked-vs-runtime)
  - [3.1 Baked vs runtime](#31-baked-vs-runtime)
  - [3.2 The design system](#32-the-design-system)
  - [3.3 The navbar](#33-the-navbar)
  - [3.4 The liaradoc resource/replacement system](#34-the-liaradoc-resourcereplacement-system)
- [4. The builder image](#4-the-builder-image)
  - [4.1 Where the schemas come from](#41-where-the-schemas-come-from)
  - [4.2 Building and publishing the image](#42-building-and-publishing-the-image)
- [5. Authoring a module's docs](#5-authoring-a-modules-docs)
- [6. Building and publishing](#6-building-and-publishing)
  - [6.1 Versioning](#61-versioning)
- [7. Hosting](#7-hosting)
  - [7.1 URL surface (quick reference)](#71-url-surface-quick-reference)
- [8. PR previews](#8-pr-previews)

---

## 1. The big picture

The documentation is **not** built in one place. Shared look-and-feel lives in one repository, the build logic lives in a container image, each module builds its own docs from its own sources, and everything is published to a single hosting repository served at the edge.

```mermaid
flowchart TB

    subgraph Shared["docs-shared"]
        DS["templates + assets<br/>(theme, navbar, tokens, doxygen)"]
        DK["docker/liara-documentation-builder/Dockerfile<br/>+ docker/scripts/ (build-docs.sh, processor.py...)"]
        IMG["ghcr.io/liara-engine/<br/>liara-documentation-builder"]

        DK -->|"COPYs mdbook/, doxygen/,<br/>shared-content/assets/ from this<br/>same checkout — builds & publishes"| IMG
    end

    LIARA["liara (meta)<br/>schemas/ (served via GitHub Pages)"]

    subgraph Repos["Repositories generating documentation"]
        LI["liara-interfaces<br/>(classic module)"]
        LC["liara-core<br/>(classic module)"]
        DST["docs-shared<br/>(builds test fixtures)"]

        HTML["Generated HTML"]

        LI -->|"build-docs"| HTML
        LC -->|"build-docs"| HTML
        DST --> HTML
    end

    IMG -->|"used by CI"| LI
    IMG -->|"used by CI"| LC
    IMG -->|"used by CI"| DST

    subgraph Publishing["Documentation Publishing"]
        DOCS["liara-docs<br/>(branch: cloudflare-pages)<br/>site/&lt;repo&gt;/&lt;version&gt;/{book,doxygen}/..."]
    end

    HTML -->|"push generated HTML"| DOCS

    subgraph Delivery["Public Delivery"]
        CF["Cloudflare Worker<br/>(Static Assets + edge router)"]
        URL["liara-engine.liara-engine-documentation.workers.dev"]
    end

    DOCS -->|"Git integration → wrangler deploy"| CF
    CF --> URL

    classDef repo fill:#e8f5e9,stroke:#2e7d32;
    classDef infra fill:#e3f2fd,stroke:#1565c0;
    classDef publish fill:#fff3e0,stroke:#ef6c00;
    classDef delivery fill:#f3e5f5,stroke:#7b1fa2;

    class LI,LC,DST repo;
    class DS,DK,IMG,LIARA infra;
    class DOCS publish;
    class CF,URL delivery;
```

The mental model that makes everything else click: **docs-shared content is split in two.** Some of it is *baked* into the builder image and used at build time; the rest is *served at runtime* from a central `/shared-content/` path. Knowing which is which explains the whole repository layout (see §3). The builder image itself is now also built and published *from* docs-shared (§4.2) — it used to be built by a separate `liara` clone-and-bake step, but that indirection is gone.

## 2. The repositories and their roles

| Repository                                         | Role                                                                                                                                                                                                                                                                                                                                     |
|----------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `docs-shared`                                      | The visual identity and templates: design tokens, navbar, the mdBook theme, the Doxygen HTML template, the central hub page — **and the documentation builder itself**: `docker/` builds and publishes `ghcr.io/liara-engine/liara-documentation-builder` from this same checkout. Changing how docs *look* or are *built* happens here. |
| `liara` (meta)                                     | Hosts the JSON `schemas/`, served via GitHub Pages (§4.1). No longer hosts the builder — that moved into `docs-shared` (§4.2).                                                                                                                                                                                                           |
| `.github`                                          | Org-level **reusable workflows**: build, versioned deploy, PR previews, preview cleanup, docker image build/cleanup. Module repos call these.                                                                                                                                                                                            |
| `liara-docs`                                       | The hosting repo. Generated HTML for every module and version lives on its `cloudflare-pages` branch under `site/`. Also holds the Cloudflare Worker (`wrangler.jsonc` + `src/index.js`) and the scheduled preview sweep.                                                                                                                |
| Module repos (`liara-interfaces`, `liara-core`, …) | Each owns its own sources (`book.toml`, `docs/`, `Doxyfile`, headers, `manifest.json`) and a thin CI caller. Building a module's docs happens here.                                                                                                                                                                                      |

## 3. Anatomy of docs-shared

```
docs-shared/
├── book.toml              # docs-shared's own developer guide (this book)
├── manifest.json          # module manifest: name, description, latest, versions
├── docs/                  # source of the guide you are reading
│
├── docker/                # the documentation builder image (§4)
│   ├── liara-documentation-builder/Dockerfile
│   └── scripts/            # build-docs.sh, processor.py, resource_processor.py, replacement_processor.py
│
├── mdbook/theme/          # BAKED — mdBook theme override
│   ├── index.hbs          #   template that injects the navbar + theme bridge
│   ├── css/variables.css  #   maps mdBook's CSS vars onto Liara design tokens
│   └── highlight.js       #   custom Highlight.js bundle (GLSL, Dockerfile, …)
│
├── doxygen/               # BAKED — Doxygen HTML template
│   ├── header.html        #   injects <shared-navbar> + /shared-content scripts
│   └── footer.html
│
├── shared-content/        # RUNTIME — served from /shared-content/ on the site
│   ├── tokens/design-tokens.css     # single source of truth for the palette
│   ├── navbar/                      # navbar.html, .css, .js, .config.js, shared-navbar.js
│   ├── mdbook/                      # custom.css + generated shared-navbar.js + liaradoc
│   ├── doxygen/                     # doxygen-custom.css + generated shared-navbar.js + liaradoc
│   ├── hub/                         # generated shared-navbar.js + liaradoc
│   └── assets/logo.svg              # also BAKED (see below) — Doxyfiles reference it at build time
│
└── hub/                   # the central landing page (deployed to the site root)
    ├── index.html
    ├── css/style.css
    ├── js/liara-hub.js
    └── 404.html           # custom not-found page (served at the site root)
```

### 3.1 Baked vs runtime

* **Baked** (`mdbook/theme/`, `doxygen/`, and `shared-content/assets/` for the logo/favicon referenced by Doxyfiles at build time): `COPY`'d directly into the builder image by `docker/liara-documentation-builder/Dockerfile`, from this same checkout — no separate download or version pin (§4.2). These templates run during *every* module build and decide the structure of the generated pages. A change here takes effect once the builder image is rebuilt, which now happens automatically on every push to `main` and on every release tag (§4.2).
* **Runtime** (`shared-content/`): never baked. It is deployed once to the site root at `/shared-content/`, and every generated page references it by absolute URL (`/shared-content/tokens/design-tokens.css`, etc.). A change here takes effect on the live site as soon as the shared-content is redeployed — no module rebuild needed.

This split is why a CSS tweak can go live without rebuilding every module, but a template change requires a new image — automatically rebuilt for you, but still a rebuild.

### 3.2 The design system

`shared-content/tokens/design-tokens.css` is the single source of truth for colours, typography, spacing, radii, and shadows. The mdBook theme (`variables.css`) and the Doxygen CSS (`doxygen-custom.css`) both consume those tokens, so the three surfaces — hub, mdBook, Doxygen — stay visually identical. Light/dark/dyslexia modes are all driven from this one file.

### 3.3 The navbar

`shared-content/navbar/` holds the shared navigation. `navbar.js` reads the **modules registry** and each module's **manifest** at runtime to build the per-module dropdowns and version selectors; `navbar.config.js` tells it where the docs are hosted (`docsBaseUrl`) and where the registry lives. The `<shared-navbar>` web component is registered per context by the generated `shared-navbar.js` files (mdBook / Doxygen / hub), produced from a single template via the `{{{MODULE}}}` replacement.

`navbar.js` reads both manifest schema versions transparently (detected via `manifest_version`, absent = v1). A v2 manifest's `kind` (`contract`/`module`/`host`/`infrastructure`) takes over the module's ABI role from the registry's `is_abi`/`meta` flags once that module has migrated, and a version's optional `note` (v2 only) is shown under it in the dropdown. See §5 and `docs/authoring-a-module.md` for the manifest formats themselves.

### 3.4 The liaradoc resource/replacement system

Files named `*.liaradoc.json` declare, per context, which static **resources** to copy into the output and which **replacements** to perform in the generated HTML (for example `{{{LOGO}}}`, `{{{MODULE}}}`, or `<DOCS_SHARED_BASE>`). The builder's processor (see §4) reads these and rewrites the pages accordingly. They conform to the `documentation-module.schema.json` schema.

## 4. The builder image

`ghcr.io/liara-engine/liara-documentation-builder` is an ultra-light Debian image that bakes in:

* **Doxygen** and **mdBook** binaries,
* the docs-shared **baked templates** (`/opt/docs-shared`) — `COPY`'d straight from this checkout's `mdbook/`, `doxygen/`, and `shared-content/assets/` (§3.1),
* the build scripts: `build-docs` plus the `processor.py` family, from `docker/scripts/`,
* `ajv` for JSON-schema validation.

It expects the module's sources mounted at `/src` and writes generated HTML to `/docs`. `build-docs` runs roughly:

1. **Validate** `manifest.json` (required) and any `*.liaradoc.json` against  their schemas; fail fast on error.
2. **Stage shared assets**: copy `/opt/docs-shared/*` into `/src/docs-shared/` so the mdBook theme path (`docs-shared/mdbook/theme`) and the Doxygen header resolve locally.
3. **Process** resources and replacements (`processor.py`): copy declared resources, substitute placeholders in the HTML.
4. **Doxygen**: if a `Doxyfile` exists, run it (output forced to `/src/build/doxygen`), then copy the HTML to `/docs/doxygen`.
5. **mdBook**: if a `book.toml` exists, auto-generate `SUMMARY.md` when missing (from `README.md` + the other pages), then build to `/docs/book`.
6. **Extra**: copy any `ADDITIONAL_DIRECTORIES_TO_OUTPUT` through verbatim.

The Dockerfile lives inside docs-shared itself and `COPY`s the baked templates from the same build context — there is no version pin to keep in sync by hand (no more `DOCS_SHARED_VERSION`, no clone of a separately-tagged release). The image built from a given commit always bakes in *that commit's* templates.

### 4.1 Where the schemas come from

Validation resolves the URL declared in each file's `$schema` and fetches it over HTTP — the builder and the `validate-manifest` workflow both do this. The schemas therefore have to be published somewhere reachable, and they are served from GitHub Pages on the `liara` repository (https://liara-engine.github.io/liara/schemas/…). It is the one piece of the documentation infrastructure that did not move to Cloudflare, because the URL is pinned as a `const` inside the schemas themselves and moving it would invalidate every existing `manifest.json` at once. This is also the one part of the builder that `liara` still hosts — the Dockerfile and scripts moved to docs-shared, but the schemas didn't.

Two consequences: a change to a schema takes effect only once Pages has redeployed, not at the next build, and a build without network access cannot validate.

### 4.2 Building and publishing the image

`.github/workflows/generate-and-push-docker.yml` builds and pushes the image, using the same trigger/tagging scheme as the doc-deploy workflows in §6 — one version number now drives both:

* **Push to `main`** (touching `docker/**`, `mdbook/**`, `doxygen/**`, or `shared-content/assets/**`): builds and pushes `dev`, and updates `:latest`.
* **Release tag `vX.Y.Z`** — the same tag `release-please` creates for docs-shared itself (§6.1): builds and pushes that exact version tag, and updates `:latest`. There is no separate `docker-vX.Y.Z` tag or release cycle anymore; one tag drives both the docs-shared release and the image that bakes in its templates.
* **Pull request** touching those paths: builds and pushes a `pr-<n>` preview tag, so a Dockerfile/template change can be validated end-to-end before merging (§8).
* **`workflow_dispatch`**: manual rebuild.

`:latest` — what `docs.yml`, `deploy-shared.yml`, `deploy-hub.yml`, and `deploy-preview.yml` all pull — is updated on every push to `main` or release tag, so it can no longer go stale relative to a merged template change. A weekly `clean-ghcr.yml` sweep prunes old image versions from the registry, keeping the last 3.

## 5. Authoring a module's docs

A module repository provides:

* `manifest.json` — required. Declares `metadata.name`, `metadata.description`, `metadata.latest`, and a `versions` map with ABI compatibility. `latest` drives the `/<repo>/latest/` redirect (see §7). Two schema versions are supported side by side — v1 (`module-manifest.schema.json`) and v2 (`module-manifest-v2.schema.json`, which adds `manifest_version`, `kind`, `metadata.repo`, and per-version `note`) — see `docs/authoring-a-module.md` §1 for the full shape of each and how the navbar picks between them.
* `book.toml` + `docs/` — optional mdBook guide. `theme = "docs-shared/mdbook/theme"`. If there is no `SUMMARY.md`, one is generated from `README.md` first, then the remaining pages.
* `Doxyfile` + headers — optional API reference. `HTML_HEADER`/`HTML_FOOTER` point at `docs-shared/doxygen/`.
* `*.liaradoc.json` — optional per-module resources and replacements.

In practice every module has a book; some also have a Doxygen reference. The worker's fallback (§7) tolerates a module that has only one of the two.

## 6. Building and publishing

This section covers how *module documentation* (including docs-shared's own guide) is built using the image described in §4 — see §4.2 for how the image itself is built and published.

CI lives as **reusable workflows** in `.github`, called by a thin caller in each module repo:

* **Build** runs the builder image against the checkout and uploads the generated `docs` and `manifest` as artifacts.
* **Deploy** checks out `liara-docs`, places the build under `site/<repo>/<version>/`, copies `manifest.json` to the canonical `site/<repo>/manifest.json`, and pushes to the `cloudflare-pages` branch. Old versions are left in place, so previous docs stay reachable.

### 6.1 Versioning

* `dev` tracks the development branch; `x.y.z` are releases.
* Each version is a directory under `site/<repo>/`, so nothing is overwritten on release — `/<repo>/1.0.0/` and `/<repo>/dev/` coexist.
* `manifest.metadata.latest` records the newest version; the hub's `version.json` and the `modules-registry.json` (both at the site root) drive the navbar's version selector and module list.

## 7. Hosting

`liara-docs` is deployed via Cloudflare's Git integration as a **Workers Static Assets** project. The `site/` directory is served directly; a small Worker (`src/index.js`) runs only when no static asset matches a request. The Worker handles three things:

* **`latest`** — `/<repo>/latest/…` reads `metadata.latest` from the module's manifest and 302-redirects to the concrete version. `/<repo>` alone resolves to latest too. These redirects are `no-cache` because latest moves.
* **View fallback** — `/<repo>/<version>/` with no view 301/302-redirects to `book/` if it exists, else `doxygen/`.
* **Custom 404** — anything unresolved is served `/404.html` with a 404 status.

### 7.1 URL surface (quick reference)

| URL                                                                | Result                               |
|--------------------------------------------------------------------|--------------------------------------|
| `/`                                                                | The hub landing page                 |
| `/<repo>/<version>/book/…`                                         | mdBook page (static)                 |
| `/<repo>/<version>/doxygen/…`                                      | Doxygen page (static)                |
| `/<repo>/<version>/`                                               | → `book/` (or `doxygen/`)            |
| `/<repo>/latest/…`                                                 | → resolved version from the manifest |
| `/<repo>` or `/<repo>/`                                            | → latest → `book/`                   |
| `/<repo>/pr-<n>/…`                                                 | A PR preview (see §8)                |
| `/shared-content/…`                                                | Runtime shared assets                |
| `/modules-registry.json`, `/version.json`, `/<repo>/manifest.json` | Metadata consumed by the navbar      |
| anything else                                                      | The custom 404 page                  |

## 8. PR previews

To test changes before merging, each PR can publish a throwaway build to a hidden path, reachable only by direct URL (the navbar never lists it).

* **Classic modules** publish to `site/<repo>/pr-<n>/`, built by the same toolchain as a real version but **without** touching the canonical `manifest.json`. Triggered automatically when documentation files change (path filter), or on demand via the `docs-preview` label. The preview URL is posted as a sticky comment on the PR.
* **docs-shared** is special: a PR there changes the templates and shared assets everyone uses, so its preview builds the **test fixtures** (`tests/fixtures/`) with *the PR's* versions of both — the baked templates are mounted over `/opt/docs-shared`, and the PR's `shared-content/` is bundled into the preview with `/shared-content/` references re-pointed at it. Output lands at `site/docs-shared/pr-<n>/`.

A related but separate preview exists for the **builder image itself** (§4.2): a PR touching `docker/`, `mdbook/`, `doxygen/`, or `shared-content/assets/` gets a `pr-<n>`-tagged image pushed to GHCR — not to GitHub Pages — letting a Dockerfile or template change be validated against the real toolchain before merging, independently of whether it also happens to touch the docs preview above.

Cleanup: docs previews are removed when the PR closes, and a daily **sweep** prunes anything whose PR is closed or has been idle for more than 30 days. Docker image previews are removed on PR close too (the `docker` job in `preview-cleanup.yml`, alongside the docs-preview cleanup job); there is no separate idle sweep for them, but the weekly `clean-ghcr.yml` retention policy (keep the last 3 versions) acts as a backstop.

These previews are the supported way to validate documentation changes — there is intentionally no separate local-only path, because reproducing the full toolchain locally is more error-prone than running the real thing on a hidden URL.

## 9. Where to change what

| You want to change…          | Edit…                                       | Takes effect after…                                      |
|------------------------------|---------------------------------------------|----------------------------------------------------------|
| Colours, typography, spacing | `docs-shared/shared-content/tokens/`        | shared-content redeploy                                  |
| Navbar behaviour or markup   | `docs-shared/shared-content/navbar/`        | shared-content redeploy                                  |
| mdBook page structure        | `docs-shared/mdbook/theme/`                 | builder image rebuild (automatic, §4.2) + module rebuild |
| Doxygen page structure       | `docs-shared/doxygen/`                      | builder image rebuild (automatic, §4.2) + module rebuild |
| Build steps / processors     | `docs-shared/docker/`                       | builder image rebuild (automatic, §4.2)                  |
| Validation rules             | `liara/schemas/`                            | next build, once GitHub Pages has redeployed             |
| Redirects, 404, hosting      | `liara-docs/src/index.js`, `wrangler.jsonc` | `wrangler deploy` (Git push)                             |
| CI behaviour                 | `.github` reusable workflows                | next workflow run                                        |

---

[Back to top](#the-documentation-pipeline)
