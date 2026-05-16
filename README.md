# docs-shared

> Shared design system, navbar, and templates consumed by every Liara
> Engine documentation site.

`docs-shared` is the visual and structural backbone of every documentation
property in the Liara Engine project. It contains the design tokens, the
shared navbar, the Doxygen and mdBook templates, and the source of the
central hub page. Every module's documentation pulls from this repository
at build time so all sites look and behave consistently.

This repository **does not build anything itself**. It is a collection of
assets and templates consumed by the documentation build pipeline (see
[How it integrates with module builds](#how-it-integrates-with-module-builds)
below).

## Repository layout

```
docs-shared/
├── README.md                       This file.
├── assets/
│   ├── favicon.ico                 Square favicon for older browsers.
│   └── logo.svg                    Vector favicon / project logo,
│                                   consumed by liaradoc favicon
│                                   declarations.
├── tokens/
│   └── design-tokens.css           Single source of truth for all colors,
│                                   fonts, spacing, and theming. Imported
│                                   first by every consuming page.
├── navbar/
│   ├── navbar.html                 Static HTML fragment shared by every
│                                   page through the {{{NAVBAR}}} placeholder.
│   ├── navbar.config.js            Centralized configuration (docs base
│                                   URL, registry path).
│   ├── navbar.css                  Styles for the navbar and the
│                                   contextual sub-nav (book vs doxygen).
│   └── navbar.js                   Runtime logic: theme toggle, a11y
│                                   toggle, module dropdowns with ABI
│                                   compatibility badges, sub-nav.
├── doxygen/
│   ├── header.html                 Doxygen header template (replaces the
│                                   default <head> + body opening).
│   ├── footer.html                 Doxygen footer template.
│   ├── doxygen-custom.css          Overrides for Doxygen's default
│                                   stylesheet to match the Liara palette.
│   ├── doxygen.liaradoc.json       Placeholder substitutions + favicon
│                                   resources for this directory.
│   └── README.md                   Integration instructions for Doxygen.
├── mdbook/
│   ├── theme/                      mdBook's recognized theme directory.
│   │   ├── index.hbs               Handlebars template override.
│   │   ├── highlight.css           Syntax highlighting override.
│   │   ├── mdbook.liaradoc.json    Placeholder substitutions + favicon
│   │                               resources for this directory.
│   │   └── css/
│   │       └── variables.css       Bridges mdBook variables to Liara tokens.
│   ├── additionals/                Extras NOT recognized by mdBook's
│   │                               theme convention; listed in
│   │                               book.toml's additional-css / -js.
│   │   ├── css/
│   │   │   └── custom.css          Liara-specific tweaks for mdBook.
│   │   └── js/
│   │       └── admonitions.js      Decorates labeled blockquotes
│   │                               (Note, Tip, Warning, Danger).
│   └── README.md                   Integration instructions for mdBook.
└── hub/
    ├── index.html                  Source for the central hub landing page.
    ├── style.css                   Styles for the hub.
    ├── script.js                   Hub-specific JS: pulls module manifests
    │                               to render dynamic version chips.
    └── modules-registry.json       The module registry consumed by the
                                    shared navbar to populate per-module
                                    dropdowns. Deployed at the hub's root.
```

## How it integrates with module builds

The Liara documentation pipeline runs each module's docs build inside a
Docker container. `docs-shared` is **baked into the container image at
image build time**, not pulled per-build — this keeps documentation
builds fast and ensures every build with the same image tag produces
byte-identical theming. The build script copies the in-image
`docs-shared` (at `/opt/docs-shared`) into the module's source directory
as `docs-shared/`, so all references can be relative.

A useful property of this layout: docs-shared brings its own
`*.liaradoc.json` files for the directories that need processor work
(see `doxygen/doxygen.liaradoc.json` and `mdbook/theme/mdbook.liaradoc.json`).
That means a module consuming Doxygen or mdBook doesn't have to
re-declare the `{{{NAVBAR}}}` and `{{{LOGO}}}` substitutions — they are
applied automatically when the processor scans for liaradoc files. Only
static-HTML consumers (like the hub) need to write their own liaradoc.

Three consumption mechanisms coexist, one per kind of consumer:

### Doxygen consumers

A module's `Doxyfile` references `docs-shared/doxygen/header.html`,
`footer.html`, `doxygen-custom.css`, and the navbar/tokens directly:

```doxyfile
HTML_HEADER            = docs-shared/doxygen/header.html
HTML_FOOTER            = docs-shared/doxygen/footer.html
HTML_EXTRA_STYLESHEET  = docs-shared/tokens/design-tokens.css \
                         docs-shared/navbar/navbar.css \
                         docs-shared/doxygen/doxygen-custom.css
HTML_EXTRA_FILES       = docs-shared/navbar/navbar.config.js \
                         docs-shared/navbar/navbar.js
```

See [`doxygen/README.md`](doxygen/README.md) for the full configuration.

### mdBook consumers

A module's `book.toml` points `theme` at `docs-shared/mdbook/theme` and
lists the design tokens and navbar files under `additional-css` and
`additional-js`:

```toml
[output.html]
theme = "docs-shared/mdbook/theme"
additional-css = [
    "docs-shared/tokens/design-tokens.css",
    "docs-shared/navbar/navbar.css"
]
additional-js = [
    "docs-shared/navbar/navbar.config.js",
    "docs-shared/navbar/navbar.js"
]
```

See [`mdbook/README.md`](mdbook/README.md) for the full configuration.

### Static HTML consumers

Plain HTML pages — like the hub — declare their dependencies in a
`*.liaradoc.json` manifest that the build's Python processor reads.
The processor copies the listed CSS/JS resources into the build output
and performs string substitutions like `{{{NAVBAR}}}` → contents of
`docs-shared/navbar/navbar.html`. Example excerpt from `hub.liaradoc.json`:

```json
{
  "$schema": "https://liara-engine.github.io/liara/schemas/documentation-module.schema.json",

  "resources": {
    "css": [
      "docs-shared/tokens/design-tokens.css",
      "docs-shared/navbar/navbar.css"
    ],
    "js": [
      "docs-shared/navbar/navbar.config.js",
      "docs-shared/navbar/navbar.js"
    ]
  },

  "replacements": {
    "{{{NAVBAR}}}": {
      "is-file": true,
      "value": "docs-shared/navbar/navbar.html",
      "only-in-files": ["index.html"]
    }
  }
}
```

## The design system

`tokens/design-tokens.css` is the canonical source for all visual values.
Every other CSS file in this repository consumes its variables and adds
**nothing** that could be expressed as a token. To change a color, font,
spacing, or radius globally, change it once in `design-tokens.css` and
every consumer follows.

Three theme modes coexist:

- **Light** (default): warm pastel palette inspired by Enid Sinclair —
  rose primary, lavender secondary, cream accent, soft pink-white base.
- **Dark**: same pastels lifted onto a deep purple-black base
  (`#1E1A1F`), warmer than a pure-black night theme.
- **Dyslexia-friendly** (orthogonal to light/dark): swaps Inter for
  OpenDyslexic, increases line-height and letter spacing, replaces
  italics with a primary-colored underline. Combinable with either
  light or dark.

Theme selection follows priority order: explicit user choice (saved to
`localStorage`) → system preference (`prefers-color-scheme`) → light
default. The navbar's theme toggle cycles through system → light → dark
→ system. See `tokens/design-tokens.css` for the full token reference.

## The shared navbar

The navbar is the unifying element across every documentation site. It
provides:

- **Brand** linking back to the hub root.
- **One pill per module**, each with a clickable name (links to the
  module's latest version) and a chevron dropdown listing all available
  versions with ABI compatibility badges.
- **Theme toggle**, **dyslexia-friendly toggle**, **GitHub link**.
- A **contextual sub-nav** that appears only on module pages, showing
  the current module + version and two tabs: Developer guide (the
  module's mdBook) and API reference (the module's Doxygen).

### How the dropdowns know what to show

On every page load, `navbar.js`:

1. Reads `window.LIARA_NAVBAR_CONFIG` (set by `navbar.config.js`) for
   the docs base URL.
2. Fetches `{docsBaseUrl}/modules-registry.json` to know which modules
   exist.
3. In parallel, fetches each module's `{docsBaseUrl}/{repo}/manifest.json`
   for its version list and ABI compatibility data.
4. Parses the current URL to detect which module / version / view (book
   or doxygen) is being viewed.
5. Computes the "ABI horizon" — the set of ABI versions compatible with
   the currently viewed version.
6. Renders each module pill with a dropdown of its versions, each
   labelled compatible / mismatch / current / unknown based on the
   horizon.

Failures along the way are non-fatal: a missing registry produces an
empty module list, a missing manifest produces a single placeholder
entry, etc.

### Per-module compatibility logic

If you are viewing **the ABI itself** (`liara-interfaces`), the "current
ABI version" is simply the version you are viewing. For another module,
the current ABI horizon is `manifest.versions[currentVersion].abi_compatibility`
— an array of ABI versions this module version is known to work with.

A target version is reported as `compatible` if:

- For the ABI itself: its label is in the current ABI horizon.
- For any other module: its `abi_compatibility` array overlaps the
  current ABI horizon.

Otherwise: `mismatch`. Mismatched rows are visible but dimmed; users
can still navigate to them deliberately.

## Adding a new module to the navbar

Three steps:

1. **Edit `hub/modules-registry.json`** to add an entry:

   ```json
   {
     "key": "editor",
     "name": "Editor",
     "repo": "liara-editor"
   }
   ```

2. **Ensure the new module publishes a `manifest.json`** compliant with
   the `module-manifest.schema.json` schema. Its location after
   deployment must be `{docsBaseUrl}/{repo}/manifest.json`. The build's
   reusable workflow takes care of publishing it from each module's
   build. Eventually, you can specify `only_mdbook` or `only_doxygen` if the module only has one kind of documentation, to avoid showing the sub-nav and redirecting users to a 404 page if they click the missing tab.

3. **(Optional)** Add a corresponding card in `hub/index.html`'s modules
   grid so visitors to the hub see the new module alongside the others.

That's it — no other touchpoints. The navbar's per-module dropdowns and
compatibility badges populate automatically on the next page load.

## Versioning

`docs-shared` is **not** versioned with semantic releases. Instead, it
is baked into the documentation Docker image at image build time, and
that image is tagged for reproducibility. The flow is:

1. A change is pushed to `docs-shared`.
2. The Docker image is rebuilt (manually or via CI) with a new tag.
3. Each module repository references the image tag in its docs
   workflow input.

To **roll back** a problematic change, point the affected module's
workflow at a previous image tag and re-run — the old `docs-shared`
state is preserved inside that earlier image. No need to revert the
docs-shared repo itself.

Trade-offs this design embraces:

- **Pro**: a single image tag captures the entire docs-shared state.
  Reproducibility is guaranteed.
- **Pro**: documentation builds are fast — docs-shared is not fetched
  per build.
- **Pro**: rollback is just a tag change in the module's workflow.
- **Con**: publishing a docs-shared change requires rebuilding the
  Docker image. Not instant.

For a coordinated rollout of a breaking change (renaming a token,
removing a CSS class, changing the structure of `navbar.html`), bump
the image tag and update each module repository to pull the new tag —
the same way you would upgrade any versioned dependency.

## Related schemas

Three JSON schemas govern the documentation system. They are hosted on
the meta repository's GitHub Pages:

| Schema                                  | Validates                       | URL                                                                                    |
|-----------------------------------------|---------------------------------|----------------------------------------------------------------------------------------|
| `documentation-module.schema.json`      | `*.liaradoc.json` files         | <https://liara-engine.github.io/liara/schemas/documentation-module.schema.json>        |
| `module-manifest.schema.json`           | per-module `manifest.json`      | <https://liara-engine.github.io/liara/schemas/module-manifest.schema.json>             |
| `modules-registry.schema.json`          | hub's `modules-registry.json`   | <https://liara-engine.github.io/liara/schemas/modules-registry.schema.json>            |

The schema files themselves live in the meta repository under
`docs/schemas/`. Validation runs in CI for every commit that touches a
`.json` file referencing one of these schemas.

## License

MIT. See `LICENSE` at the root of this repository.