# Doxygen integration

This directory contains the Liara-themed Doxygen templates. They are
consumed automatically by the Liara documentation pipeline; the
instructions below describe how a module's `Doxyfile` should reference
them.

## Files

| File                       | Role                                                          |
|----------------------------|---------------------------------------------------------------|
| `header.html`              | Replaces Doxygen's default `<head>` and opens `<body>` with the shared navbar inlined. |
| `footer.html`              | Closes `<body>` with a discreet footer line.                  |
| `doxygen-custom.css`       | Restyles every Doxygen output element to match the Liara design system. |
| `doxygen.liaradoc.json`    | Declares the `{{{NAVBAR}}}` and `{{{LOGO}}}` placeholder substitutions in `header.html`, plus favicon resources. Read automatically by the build processor — modules do not need their own liaradoc to handle these. |

These files depend on assets from the parent `docs-shared` repo
(`tokens/design-tokens.css`, `navbar/navbar.css`, `navbar/navbar.js`,
`navbar/navbar.config.js`). The documentation pipeline takes care of
making them available alongside the generated output.

## How docs-shared reaches the build

When a module's docs build runs inside the Liara Docker image, the
build script copies `/opt/docs-shared` (mounted from the image) into
`${SRC_DIR}/docs-shared/`. From the module's point of view, every
docs-shared file is reachable at a `docs-shared/...` path relative to
the source directory. The `Doxyfile` therefore references them with
plain relative paths — no environment variables, no symlinks.

## Doxyfile configuration

Add the following to the module's `Doxyfile`:

```doxyfile
# --- Liara templates -------------------------------------------------------
HTML_HEADER            = docs-shared/doxygen/header.html
HTML_FOOTER            = docs-shared/doxygen/footer.html

# Stylesheets. Order matters: design-tokens MUST come first so that the
# variables it defines are available to the others.
HTML_EXTRA_STYLESHEET  = docs-shared/tokens/design-tokens.css \
                         docs-shared/navbar/navbar.css \
                         docs-shared/doxygen/doxygen-custom.css

# Files copied verbatim into the HTML output. Order matters here too:
# navbar.config.js must come before navbar.js (the config defines
# window.LIARA_NAVBAR_CONFIG, which navbar.js consumes).
HTML_EXTRA_FILES       = docs-shared/navbar/navbar.config.js \
                         docs-shared/navbar/navbar.js

# Sidebar layout the Liara CSS is tuned for
GENERATE_TREEVIEW      = YES
DISABLE_INDEX          = NO
FULL_SIDEBAR           = NO

# Let the Liara design tokens manage dark mode; Doxygen's own
# dark-mode toggle would compete with ours.
HTML_COLORSTYLE        = LIGHT
HTML_DYNAMIC_MENUS     = YES
```

No other Doxygen options need to change. The rest of the `Doxyfile`
(input directories, `PROJECT_NAME`, etc.) stays as you would otherwise
configure it.

## Local preview

To preview the styled output without spinning up the full Docker
pipeline, you need to make a local copy of `docs-shared` reachable
from your build directory at the path the `Doxyfile` expects.
A minimal one-liner from a module's repository root:

```bash
ln -s /path/to/docs-shared/ docs-shared
doxygen Doxyfile
xdg-open build/docs/html/index.html
```

The symlink stays only for local previews; in CI, the Docker build
handles the copy.

## Things to verify after a deployment

After the first published build, open a generated page and check:

- [ ] The shared navbar appears at the top with the per-module pills
  populated from the registry.
- [ ] The current module's pill shows the "current" badge.
- [ ] Each module's dropdown shows versions with compatibility badges
  (compatible / mismatch / current).
- [ ] The contextual sub-nav under the navbar shows "Module / version"
  on the left and the `[Developer guide] [API reference]` tabs on
  the right, with **API reference** active (since you're viewing
  Doxygen).
- [ ] Theme toggle and dyslexia toggle persist across page navigation.
- [ ] Code blocks (`.fragment`) render with the pastel syntax coloring.
- [ ] Member documentation blocks (the rounded `.memitem` cards) render
  cleanly with the lavender signature header.
- [ ] Admonitions from `@note`, `@warning`, `@bug`, `@todo` show their
  respective semantic colors.
- [ ] The side-nav tree highlights the current page in primary-soft pink.
- [ ] On screens narrower than 768px, the navbar collapses to a
  hamburger drawer.

## Customizing per module

If a specific module needs to override a token (rare, but possible):
add a per-module CSS file to `HTML_EXTRA_STYLESHEET` *after*
`doxygen-custom.css`, and redefine the relevant `--liara-*` variables
on `:root` in that file. Do **not** edit `doxygen-custom.css` itself —
that file is shared across all modules and updates flow from the
`docs-shared` repo.

## Troubleshooting

**The page renders without the Liara navbar.**
Either `header.html` is not being picked up (check the `HTML_HEADER`
path in the `Doxyfile`), or `docs-shared` was not copied alongside
the Doxygen build. Inspect the generated `index.html`: the
`<nav id="liara-navbar">` element should be present in the raw HTML
(it's emitted statically by the header template).

**The page renders with the navbar but no styling.**
The `HTML_EXTRA_STYLESHEET` paths are wrong, or the order is broken
(`design-tokens.css` must come first). Open browser DevTools, check
the Network tab for 404s on the CSS files, and verify they all load
in the order declared.

**The module dropdowns are empty.**
`navbar.js` could not fetch the registry. Common causes:
- `docs-shared/navbar/navbar.config.js` is missing from
  `HTML_EXTRA_FILES`, so `window.LIARA_NAVBAR_CONFIG` is undefined.
- The `docsBaseUrl` configured in `navbar.config.js` is wrong (e.g.,
  points to a stale deployment URL).
- The hub's `modules-registry.json` is not deployed yet at the
  expected location.

Check the browser console — `navbar.js` logs a warning when a fetch
fails.

**The theme toggle has no effect.**
The browser cached an old version of `navbar.js`. Hard-refresh
(Ctrl+Shift+R). If the issue persists, verify that `navbar.js`
actually loaded by inspecting the page source.

**Validation errors in Doxygen's HTML output.**
Doxygen's substitution tokens (`$projectname`, `$relpath^`, etc.) must
not be removed from `header.html` and `footer.html`. If you edit
these templates, preserve every `$...` token unless you understand
its role.