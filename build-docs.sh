#!/usr/bin/env bash

set -Eeuo pipefail

readonly TOOLS="${LIARA_TOOLS:-/opt/liara/tools}"
readonly SRC="${PWD}"

readonly SRC_CONFIG="${SRC}/astro.config.mjs"
readonly SRC_ABOUT="${SRC}/about"
readonly SRC_GUIDES="${SRC}/docs"
readonly SRC_API="${SRC}/include"

readonly DEST_CONFIG="/working/astro.config.mjs"
readonly DEST_ABOUT="/working/src/content/docs/about"
readonly DEST_GUIDES="/working/src/content/docs/guides"

readonly DEST_XML="/working/build/xml/xml"

OUTPUT="${SRC}/generated-docs"
SKIP_API=0

log()  { printf '\033[1;35m[docs]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[docs] error:\033[0m %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
    case "$1" in
        --output)   OUTPUT="$2"; shift 2 ;;
        --skip-api) SKIP_API=1; shift ;;
        *)          die "unknown argument: $1" ;;
    esac
done

: "${LIARA_DOCS_REPO:?LIARA_DOCS_REPO must name the module repository}"
: "${LIARA_DOCS_VERSION:?LIARA_DOCS_VERSION must name the version segment}"
export LIARA_ASSETS_PREFIX="${LIARA_ASSETS_PREFIX:-/_cas/}"

readonly BASE="/${LIARA_DOCS_REPO}/${LIARA_DOCS_VERSION}"

# ---------------------------------------------------------------------------
# 0. Preconditions
# ---------------------------------------------------------------------------

log "pwd: ${PWD}"
log "ls -l: $(ls -l "${SRC}")"

[ -f "${SRC}/manifest.json" ] || die "no manifest.json at the repository root"

log "building ${LIARA_DOCS_REPO} ${LIARA_DOCS_VERSION} for ${BASE}"

# ---------------------------------------------------------------------------
# 1. Copy content
# ---------------------------------------------------------------------------

log "copying content into /working"
rm -rf "${DEST_ABOUT}" "${DEST_GUIDES}" "${DEST_XML}"
mkdir -p "${DEST_ABOUT}" "${DEST_GUIDES}"

rm -f "${DEST_CONFIG}"
if [ -f "${SRC_CONFIG}" ]; then
    cp -a "${SRC_CONFIG}" "${DEST_CONFIG}"
else
    log "no astro.config.mjs at the repository root — one will be generated from manifest.json"
fi

cp -a "${SRC}/manifest.json" "/working/manifest.json"

cp -a "${SRC_ABOUT}/." "${DEST_ABOUT}/" || log "no about/ content"
cp -a "${SRC}/README.md" "${DEST_ABOUT}/README.md" || log "no README.md content"
cp -a "${SRC}/CHANGELOG.md" "${DEST_ABOUT}/CHANGELOG.md" || log "no CHANGELOG.md content"
cp -a "${SRC}/LICENSE" "${DEST_ABOUT}/LICENSE.md" || log "no LICENSE content"
cp -a "${SRC_GUIDES}/." "${DEST_GUIDES}/" || log "no docs/ content"

LIARA_DOCS_API=false

if [ "$SKIP_API" -eq 0 ] && [ -f "${SRC}/Doxyfile" ]; then
    log "extracting the API surface"
    mkdir -p "$(dirname "${DEST_XML}")"
    {
        cat "${SRC}/Doxyfile"
        echo
        echo "INPUT = ${SRC_API}"
        echo 'GENERATE_XML = YES'
        echo 'GENERATE_HTML = NO'
        echo 'GENERATE_LATEX = NO'
        echo 'XML_PROGRAMLISTING = NO'

        # `\internal` is how a module says "this is not part of the surface"
        # without moving the code. With INTERNAL_DOCS off — Doxygen's default
        # — everything after the marker is stripped while it writes the XML,
        # so the loader never learns the header was marked at all. Keeping it
        # in the XML is what lets api/filter.mjs act on it; nothing marked
        # internal is ever rendered, so switching this on publishes nothing
        # that was not published before.
        echo 'INTERNAL_DOCS = YES'

        # Declaration order is information: a struct's field order is its
        # memory layout, and a header's function order is how its author
        # grouped them. The preset groups members by kind itself and keeps
        # what is inside a group as written, so Doxygen must not have
        # alphabetised it first.
        echo 'SORT_MEMBER_DOCS = NO'
        echo 'SORT_BRIEF_DOCS = NO'
        echo "OUTPUT_DIRECTORY = $(dirname "${DEST_XML}")"
        echo "XML_OUTPUT = $(basename "${DEST_XML}")"
        echo 'QUIET = YES'

        # A Doxyfile written for the retired mdBook/Doxygen toolchain still
        # generates HTML with a theme that no longer exists — HTML_HEADER,
        # HTML_FOOTER and the rest pointing into a shared checkout that is not
        # mounted any more. Doxygen validates those paths while it reads the
        # configuration, before it gets as far as noticing that HTML output is
        # switched off, and exits: `error: tag HTML_HEADER: header file '...'
        # does not exist`. Rebuilding an old release therefore failed on a
        # file the build would never have opened. Clearing the tags restores
        # Doxygen's built-in defaults, which need no files at all, and costs
        # nothing for a module whose Doxyfile never mentioned them.
        echo 'HTML_HEADER ='
        echo 'HTML_FOOTER ='
        echo 'HTML_STYLESHEET ='
        echo 'HTML_EXTRA_STYLESHEET ='
        echo 'HTML_EXTRA_FILES ='
        echo 'LAYOUT_FILE ='
        echo 'LATEX_HEADER ='
        echo 'LATEX_FOOTER ='
        echo 'LATEX_EXTRA_STYLESHEET ='
        echo 'LATEX_EXTRA_FILES ='
    } | doxygen - || die "Doxygen failed"

    [ -f "${DEST_XML}/index.xml" ] \
        || die "Doxygen produced no index.xml; check INPUT in the Doxyfile"
    log "  $(find "${DEST_XML}" -name '*.xml' | wc -l) compounds"

    LIARA_DOCS_API=true
else
    log "no Doxyfile, or --skip-api: this module ships prose only"
fi

export LIARA_DOCS_API

mapfile -t md_files < <(find "${DEST_ABOUT}" "${DEST_GUIDES}" \
                             \( -name '*.md' -o -name '*.mdx' \))
for md_file in "${md_files[@]}"; do
    if [ "$(head -n 1 "${md_file}")" != "---" ]; then
        log "adding front matter to ${md_file}"
        title=$(basename "${md_file}"); title="${title%.*}"
        sed -i "1s|^|---\ntitle: ${title}\n---\n\n|" "${md_file}"
    fi
done

# ---------------------------------------------------------------------------
# 2. Astro
# ---------------------------------------------------------------------------

log "building the site"
cd "/working" || die "failed to cd into /working"
npm run build
cd "${SRC}" || die "failed to cd back into ${SRC}"
[ -d "/working/dist" ] || die "Astro produced no dist/"


# ---------------------------------------------------------------------------
# 3. Search
# ---------------------------------------------------------------------------

# Starlight builds one Pagefind bundle per site, and this is where it is
# decided what happens to it. The two cases match `isPreviewVersion` in
# astro/index.mjs, which is what tells the search UI where to look.
#
#   published  The site-wide index at /pagefind/ already covers this version
#              (tools/search-index.py), so the local bundle is discarded and
#              the version directory ships no search files at all. Building it
#              first costs a second and is what keeps a preview and a release
#              configured identically — see the note in astro/index.mjs.
#
#   pr-<n>     Deployed nowhere else, so it indexes itself and keeps the
#              bundle. Pagefind writes its own search UIs beside the index and
#              Starlight fetches none of them — it bundles @pagefind/default-ui
#              into its own JavaScript — so those go either way.

if [ -d "/working/dist/pagefind" ]; then
    case "${LIARA_DOCS_VERSION}" in
        pr-[0-9]*)
            log "keeping this preview's own search bundle"
            rm -f /working/dist/pagefind/pagefind-ui.js \
                  /working/dist/pagefind/pagefind-ui.css \
                  /working/dist/pagefind/pagefind-modular-ui.js \
                  /working/dist/pagefind/pagefind-modular-ui.css \
                  /working/dist/pagefind/pagefind-component-ui.js \
                  /working/dist/pagefind/pagefind-component-ui.css \
                  /working/dist/pagefind/pagefind-highlight.js
            ;;
        *)
            log "discarding the local search bundle: /pagefind/ covers this version"
            rm -rf /working/dist/pagefind
            ;;
    esac
fi

# ---------------------------------------------------------------------------
# 4. Fingerprint
# ---------------------------------------------------------------------------

log "relocating assets into the content-addressed store"
python3 "${TOOLS}/fingerprint.py" --dist "/working/dist" --base "${BASE}"

# ---------------------------------------------------------------------------
# 5. Hand over
# ---------------------------------------------------------------------------

rm -rf "${OUTPUT}"
mkdir -p "${OUTPUT}"
cp -a "/working/dist/." "${OUTPUT}/"

cp "${SRC}/manifest.json" "${OUTPUT}/manifest.json"

# debug
# cp -a "/working/." "${OUTPUT}/working/"

log "done: $(find "${OUTPUT}" -type f | wc -l) files"
