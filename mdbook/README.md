# mdBook integration

This directory contains the Liara-themed mdBook templates. To use them in
the user-facing documentation built with mdBook, follow the steps below.

## Files

```
mdbook/
├── theme/
│   ├── index.hbs                  # Replaces mdBook's default Handlebars template
│   ├── highlight.css              # Replaces highlight.js theme
│   └── css/
│       ├── variables.css          # Bridges mdBook variables to Liara tokens
│       └── custom.css             # Additional Liara-specific styles
└── README.md                      # This file
```

## book.toml configuration

In your book's `book.toml`, set the following options:

```toml
[book]
title = "Liara Engine — User Guide"
authors = ["Liara Engine contributors"]
language = "en"
src = "docs"

[output.html]
default-theme = "light"
preferred-dark-theme = "navy"
git-repository-url = "https://github.com/liara-engine/liara"
git-repository-icon = "fa-github"
edit-url-template = "https://github.com/liara-engine/liara/edit/main/docs/user/{path}"

# Use the Liara theme files
theme = "path/to/docs-shared/mdbook/theme"

# Stylesheets and scripts that aren't part of the theme directory
additional-css = [
    "../../docs-shared/tokens/design-tokens.css",
    "../../docs-shared/navbar/navbar.css",
]
additional-js = [
    "../../docs-shared/navbar/navbar.js",
]

[output.html.fold]
enable = true
level = 1

[output.html.search]
enable = true
limit-results = 30
use-boolean-and = true
boost-title = 2
boost-hierarchy = 2
boost-paragraph = 1
expand = true
heading-split-level = 2
```

The exact paths depend on how the CI assembles the documentation. The
reusable `docs.yml` workflow in `liara-engine/.github` clones `docs-shared`
into a known location and exposes it via build-time environment variables;
adjust the relative paths to match.

## How the theme works

mdBook's `theme/` directory can override any of mdBook's built-in template
and stylesheet files. Files not provided in the theme directory fall back
to mdBook's defaults. We ship four files:

- **`index.hbs`** — the master Handlebars template. We replace it to inject
  the Liara navbar at the top of every page and load our design tokens
  before mdBook's own styles.
- **`highlight.css`** — replaces the default highlight.js theme with one
  that maps token classes to the Liara palette (rose keywords, lavender
  types, peach strings, etc.).
- **`css/variables.css`** — overrides the variables that mdBook's own
  `general.css` and `chrome.css` consume, redirecting them to our
  `--liara-*` tokens. This is the magic that makes the entire mdBook
  layout adopt our palette without modifying mdBook's source.
- **`css/custom.css`** — additional Liara-specific tweaks: rounded sidebar
  items, code-block borders, blockquote admonitions, etc.

## Local preview

To preview the styled output locally, install mdBook (`cargo install mdbook`
or `pacman -S mdbook` on Arch) and run:

```bash
cd path/to/your/book
mdbook serve --open
```

This starts a local server at http://localhost:3000 with live reload. The
first time you do this on a new system, expect missing assets if you have
not arranged for `design-tokens.css`, `navbar.css`, and `navbar.js` to be
visible to mdBook through `additional-css` / `additional-js`.

## Things to check after first integration

After the first generated build, verify visually that:

- [ ] The Liara navbar appears at the top of every page
- [ ] mdBook's own menu bar (with sidebar toggle, title, search) sits
  below the Liara navbar without overlap
- [ ] Theme toggle in the Liara navbar persists across page navigation
  and the sidebar/content follow
- [ ] Dyslexia-friendly toggle persists and applies font + spacing
- [ ] Sidebar items are rounded with primary-soft pink hover
- [ ] Code blocks render with the pastel syntax highlighting
- [ ] Blockquotes (`> Note: ...`) render as info admonition cards
- [ ] Tables have the rounded header in primary-soft pink
- [ ] Search bar styling matches the navbar's version selector
- [ ] On screens narrower than 768px, both navbars adapt correctly

## Theme alignment with mdBook's own picker

mdBook ships with five built-in themes (light, rust, coal, navy, ayu) and
its own theme picker in the menu bar. We hide that picker via CSS in
`custom.css` because it would compete with the Liara navbar's theme
toggle. Behind the scenes, the Liara toggle still updates mdBook's
`<html>` class so mdBook's internal logic (sidebar state, chapter folding,
etc.) remains consistent.

If you want to expose a particular mdBook theme as an additional Liara
mode (e.g., a special "ayu-style" Liara variant), it is doable but not
done by default.

## Convention for admonitions in Markdown

Until we add a Markdown preprocessor for proper admonitions (à la
mdbook-admonish), the convention used in Liara user docs is:

```markdown
> **Note:** Standard informational callout.

> **Warning:** Something the reader should be careful about.

> **Tip:** A useful but non-essential piece of advice.

> **Danger:** Something that can cause data loss or breakage.
```

The base style (in `custom.css`) renders these as info-style callouts. A
small JavaScript enhancement (planned, optional) detects the leading
`**Note:**` / `**Warning:**` / etc. and re-themes the blockquote to the
matching semantic color. Until then, all blockquotes look like info, which
is visually fine.

## Customizing per book

If a specific book needs to override a token (rare), the override can go
in a per-book CSS file added to `additional-css` *after* `custom.css`.
Define overriding `--liara-*` variables on `:root` in that file. Do **not**
modify any of the files in the `theme/` directory — those are shared
across all Liara mdBooks and updates flow from the `docs-shared` repo.

## Troubleshooting

**The page renders without the Liara navbar.**
The `theme/index.hbs` is not being picked up. Check `book.toml`'s `theme`
option pointing at the right directory. Run `mdbook build --verbose` and
look for "Reading template ..." log lines.

**The page renders without the Liara colors.**
The `additional-css` paths are wrong. mdBook resolves them relative to
the book's root directory (where `book.toml` lives), not relative to the
theme directory. Use `..` to escape upward as needed.

**Sidebar overlaps the Liara navbar.**
The sidebar's `top` is hardcoded to `var(--liara-navbar-height)` (52px)
in `custom.css`. If you have customized the navbar height in
`design-tokens.css`, update both files together.

**The Liara theme toggle doesn't switch mdBook's appearance.**
The bridge in `index.hbs` adjusts mdBook's `<html>` class when the Liara
theme changes. Verify in the browser's DevTools that toggling the Liara
theme actually adds/removes the `light` / `navy` class on `<html>`.