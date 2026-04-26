# Doxygen integration

This directory contains the Liara-themed Doxygen templates. To use them in
a module's documentation build, follow the steps below.

## Files

| File                  | Role                                           |
|-----------------------|------------------------------------------------|
| `header.html`         | Replaces Doxygen's default `<head>` and opens `<body>` with the shared navbar |
| `footer.html`         | Closes `<body>` with a discreet footer line   |
| `doxygen-custom.css`  | Restyles every Doxygen output element to match the Liara design system |

These three files depend on assets shipped by the `docs-shared` repo:
`design-tokens.css`, `navbar.css`, and `navbar.js`. The CI workflow that
builds documentation is responsible for fetching these and placing them
alongside the generated HTML.

## Doxyfile configuration

In your module's `Doxyfile`, set the following options:

```doxyfile
# Use the Liara header/footer templates
HTML_HEADER            = path/to/docs-shared/doxygen/header.html
HTML_FOOTER            = path/to/docs-shared/doxygen/footer.html

# Stylesheets — order matters, design-tokens MUST come first
HTML_EXTRA_STYLESHEET  = path/to/docs-shared/tokens/design-tokens.css \
                         path/to/docs-shared/navbar/navbar.css \
                         path/to/docs-shared/doxygen/doxygen-custom.css

# Extra files copied verbatim into the output directory
HTML_EXTRA_FILES       = path/to/docs-shared/navbar/navbar.js

# Enable the side-nav tree (the Liara CSS is tuned for this layout)
GENERATE_TREEVIEW      = YES
DISABLE_INDEX          = NO
FULL_SIDEBAR           = NO

# Disable Doxygen's own dark mode — we manage it via design tokens
HTML_COLORSTYLE        = LIGHT
HTML_DYNAMIC_MENUS     = YES
```

The exact paths depend on how the CI fetches `docs-shared`. The reusable
`docs.yml` workflow in `liara-engine/.github` clones `docs-shared` into a
known location and exposes it via environment variables; consume those
variables from your Doxyfile or substitute them at build time.

## Local preview

To preview the styled output locally, run Doxygen as usual and open the
generated `html/index.html` in a browser:

```bash
doxygen Doxyfile
xdg-open build/docs/html/index.html
```

The first time you do this on a new system, expect missing assets if you
have not arranged for `design-tokens.css`, `navbar.css`, and `navbar.js`
to be available alongside Doxygen's output. The CI handles this; locally
you may want a small helper script.

## Things to check after first integration

After the first generated build, verify visually that:

- [ ] The shared navbar appears at the top of every generated page
- [ ] Theme toggle works and persists across page navigation
- [ ] The dyslexia-friendly toggle works and persists
- [ ] Code blocks (the `.fragment` class) render with the pastel syntax
  coloring
- [ ] Member documentation blocks (the rounded `.memitem` cards) render
  cleanly with the lavender signature header
- [ ] Admonitions from `@note`, `@warning`, `@bug`, `@todo` render with
  their respective semantic colors
- [ ] The side-nav tree highlights the current page in primary-soft pink
- [ ] On screens narrower than 768px, the navbar collapses correctly
- [ ] Search box still works (Doxygen's built-in search is preserved)

## Customizing per module

If a specific module needs to override a token (rare, but possible), the
override can go in a per-module CSS file added to `HTML_EXTRA_STYLESHEET`
*after* `doxygen-custom.css`. Define overriding `--liara-*` variables on
`:root` in that file. Do **not** modify `doxygen-custom.css` itself —
that file is shared across all modules and updates flow from the
`docs-shared` repo.

## Troubleshooting

**The page renders without the Liara navbar.**
Either `header.html` is not being picked up (check `HTML_HEADER` path), or
the navbar's CSS/JS is missing from the output. Inspect the generated
`index.html` and confirm the `<nav id="liara-navbar">` element is present.

**Code blocks are unstyled.**
The `doxygen-custom.css` file is not loading. Check `HTML_EXTRA_STYLESHEET`
order — `design-tokens.css` must come first, then `navbar.css`, then
`doxygen-custom.css`.

**The theme toggle doesn't switch.**
Either `navbar.js` is not in the output (check `HTML_EXTRA_FILES`), or
the browser cached an old version. Hard-refresh and check the browser
console for errors.

**Validation errors in Doxygen's HTML output.**
Doxygen's substitution tokens (`$projectname`, `$relpath^`, etc.) must
not be removed from `header.html` and `footer.html`. If you edit these
files, preserve every `$...` token unless you understand its role.