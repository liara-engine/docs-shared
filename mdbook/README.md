# mdBook integration

This directory contains the Liara-themed mdBook templates. They are
consumed automatically by the Liara documentation pipeline; the
instructions below describe how a module's `book.toml` should reference
them.

## Files

```
mdbook/
├── theme/                          mdBook's recognized theme directory.
│   ├── index.hbs                   Handlebars template override.
│   ├── highlight.css               Replaces highlight.js's theme.
│   └── css/
│       └── variables.css           Bridges mdBook variables to Liara tokens.
└── README.md                       This file.
```

`mdBook`'s `theme/` directory has specific file-name conventions
(`index.hbs`, `css/variables.css`, `highlight.css`, …) — only files
matching those names override mdBook's defaults. Anything else placed
there would be ignored. That is why `custom.css` and `admonitions.js`
live in `additionals/` and are wired up explicitly in `book.toml`.

The `mdbook.liaradoc.json` file is read by the documentation
processor: it declares the `{{{NAVBAR}}}` and `{{{LOGO}}}` placeholder
substitutions that decorate `index.hbs`, plus the favicon resources.
Modules consuming this theme do **not** need their own liaradoc file
for these substitutions — they happen automatically.

## How docs-shared reaches the build

`docs-shared` is baked into the documentation Docker image at image
build time. When a module's docs build runs, the build script copies
`/opt/docs-shared` (from the image) into `${SRC_DIR}/docs-shared/`. The
module's `book.toml` then references everything at `docs-shared/...`
relative to the book root.

## book.toml configuration

```toml
[book]
title    = "Liara <Module> — Developer Guide"
authors  = ["Liara Engine contributors"]
language = "en"
src      = "docs"

[output.html]
theme                 = "docs-shared/mdbook/theme"
default-theme         = "light"
preferred-dark-theme  = "navy"
hash-files            = false

git-repository-url    = "https://github.com/liara-engine/<repo>"
git-repository-icon   = "fa-github"
edit-url-template     = "https://github.com/liara-engine/<repo>/edit/main/docs/{path}"

[output.html.fold]
enable = true
level  = 1

[output.html.search]
enable             = true
limit-results      = 30
use-boolean-and    = true
boost-title        = 2
boost-hierarchy    = 2
boost-paragraph    = 1
expand             = true
heading-split-level = 2
```

Substitute `<repo>` with the module's repository name (e.g.,
`liara-interface`).

## SUMMARY.md — auto-generated if missing

mdBook requires a `SUMMARY.md` to define the book's table of contents.
For modules whose Markdown files live in a flat or shallow directory
structure, maintaining `SUMMARY.md` by hand is busywork. The Liara
build script (`build-docs.sh`) checks for it and **generates one
automatically if it is missing or empty**.

The generator's behavior:

- Walks the `src` directory (e.g. `docs/`) recursively for `.md` files,
  excluding `SUMMARY.md` itself and any path containing a directory
  named `drafts` or `templates`.
- Sorts entries alphabetically.
- Pretty-prints titles by replacing dashes and underscores with spaces
  and title-casing the result (`getting-started.md` → "Getting Started").
- For a `README.md`, the title is taken from its parent directory name.
- Indents nested entries based on directory depth.

A hand-written `SUMMARY.md` always wins — the script only generates one
when no usable summary exists. If you need a specific ordering or
custom titles, just commit your own `docs/SUMMARY.md` and the script
leaves it alone.

This auto-generation runs inside the Docker build, so you do not need
to install or invoke anything locally. For local previews, you can
either commit a `SUMMARY.md` or run `mdbook build` with an empty
`SUMMARY.md` — mdBook will refuse and tell you what is missing.

## How the theme works

mdBook's `theme/` directory overrides any of mdBook's built-in template
and stylesheet files; files not provided fall back to mdBook's defaults.
The Liara theme ships:

- **`theme/index.hbs`** — the master Handlebars template. Injects the
  Liara navbar at the top of every page and loads our design tokens
  before mdBook's own styles.
- **`theme/highlight.css`** — replaces the default highlight.js theme
  with one that maps token classes to the Liara palette.
- **`theme/css/variables.css`** — overrides the CSS variables that
  mdBook's own `general.css` and `chrome.css` consume, redirecting
  them to our `--liara-*` tokens. This is the trick that makes the
  whole mdBook layout adopt our palette without modifying mdBook
  itself.
- **`additionals/css/custom.css`** — Liara-specific tweaks (rounded
  sidebar items, code-block borders, blockquote admonitions, etc.).
  Listed in `book.toml`'s `additional-css`.
- **`additionals/js/admonitions.js`** — scans labeled blockquotes and
  applies the matching semantic styling. Listed in `book.toml`'s
  `additional-js`.

## Admonitions

Labeled blockquotes are decorated at runtime by `admonitions.js`. Use
this convention in your Markdown sources:

```markdown
> **Note:** Standard informational callout.

> **Tip:** Useful but non-essential advice.

> **Warning:** Something the reader should be careful about.

> **Danger:** Something that can cause data loss or breakage.
```

Recognized labels (case-insensitive, with or without trailing colon):

| Label                                          | Variant   | Color       |
|------------------------------------------------|-----------|-------------|
| `Note`, `Info`, `See`, `See also`              | info      | periwinkle  |
| `Tip`, `Hint`, `Success`                       | success   | sage        |
| `Warning`, `Caution`, `Important`, `Attention` | warning   | peach       |
| `Danger`, `Error`, `Deprecated`, `Bug`         | danger    | rose-red    |

Blockquotes that don't start with a recognized label get the base info
style — visually pleasant, never broken.

## Local preview

To preview without spinning up the Docker pipeline, make `docs-shared`
reachable from your book directory:

```bash
ln -s /path/to/docs-shared/ docs-shared
mdbook serve --open
```

This starts a local server at <http://localhost:3000> with live
reload. The symlink stays only for local previews; in CI, the Docker
build handles the copy.

Note: local previews do **not** run the liaradoc processor, so
`{{{NAVBAR}}}` and `{{{LOGO}}}` placeholders in `index.hbs` will appear
as literal strings unless you also run the processor manually. For most
authoring tasks this does not matter — you are editing Markdown source,
not the template.

## Things to verify after a deployment

After the first published build, open a generated page and check:

- [ ] The Liara navbar appears at the top with per-module pills.
- [ ] mdBook's own menu bar (sidebar toggle, title, search) sits below
  the Liara navbar without overlap.
- [ ] The contextual sub-nav under the Liara navbar shows the module
  breadcrumb on the left and `[Developer guide] [API reference]`
  tabs on the right, with **Developer guide** active.
- [ ] Theme toggle in the Liara navbar persists across navigation and
  the sidebar/content follow.
- [ ] Dyslexia-friendly toggle persists and applies font + spacing
  changes.
- [ ] Sidebar items are rounded with primary-soft pink hover.
- [ ] Code blocks render with the pastel syntax highlighting.
- [ ] Blockquotes prefixed with `**Note:**` / `**Tip:**` / `**Warning:**` /
  `**Danger:**` render as colored callouts with icons.
- [ ] Tables have a primary-soft pink header.
- [ ] Search bar styling matches the rest of the design system.
- [ ] On screens narrower than 768px, both navbars adapt correctly.

## Theme alignment with mdBook's own picker

mdBook ships with five built-in themes (`light`, `rust`, `coal`, `navy`,
`ayu`) and its own theme picker in the menu bar. The Liara theme hides
that picker via CSS in `additionals/css/custom.css` because it would
compete with the navbar's theme toggle. Behind the scenes, the Liara
toggle still updates mdBook's `<html>` class so its internal logic
(sidebar state, chapter folding, etc.) remains consistent.

## Customizing per book

Per-book token overrides go in a CSS file added to `additional-css`
*after* `custom.css`. Redefine the relevant `--liara-*` variables on
`:root`. Do **not** edit files inside this `mdbook/` directory — they
are shared across all Liara mdBooks and updates flow from the
`docs-shared` repo.

## Troubleshooting

**The page renders without the Liara navbar.**
The `theme/index.hbs` is not being picked up. Check `book.toml`'s
`theme` option points at the right directory. Run `mdbook build
--verbose` and look for "Reading template ..." log lines.

**The page renders without the Liara colors.**
The `additional-css` paths are wrong. mdBook resolves them relative
to the book's root directory (where `book.toml` lives). Verify that
`docs-shared/` exists at that level.

**Sidebar overlaps the Liara navbar.**
The sidebar's `top` is hardcoded to `var(--liara-navbar-height)` (52px)
in `additionals/css/custom.css`. If you have customized the navbar
height in `design-tokens.css`, the sidebar follows automatically — but
only if both files have been rebuilt.

**The module dropdowns in the navbar are empty.**
`navbar.js` could not fetch the registry. Common causes:
- `navbar.config.js` is missing from `additional-js` so
  `window.LIARA_NAVBAR_CONFIG` is undefined and the script falls back
  to `window.location.origin`, which may not point at the right base.
- The `docsBaseUrl` value inside `navbar.config.js` is wrong.
- The hub's `modules-registry.json` is not deployed yet at the expected
  location.

Check the browser console — `navbar.js` logs a warning when a fetch
fails.

**Admonitions render as plain blue blockquotes.**
The `admonitions.js` file is missing from `additional-js`, or your
blockquote does not start with `**Label:**` as the very first inline
content. Check DevTools to confirm the script loaded.

**SUMMARY.md unexpectedly missing entries.**
The auto-generator skips directories named `drafts` and `templates` to
avoid publishing in-progress content. If a chapter is silently missing,
check that its path does not contain either of those segments. To
include them anyway, commit a hand-written `SUMMARY.md`.

**The `{{{NAVBAR}}}` placeholder appears literally in the rendered page.**
The processor did not run before mdBook, or `mdbook.liaradoc.json` was
not found. In a local preview, this is expected — see the Local
preview section above.