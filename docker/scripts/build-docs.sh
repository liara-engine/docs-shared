#!/usr/bin/env bash

set -Eeuo pipefail

BOOK_DIR="${MDBOOK_SOURCE_DIR}"
SUMMARY_FILE="${BOOK_DIR}/SUMMARY.md"

# ----------------------------------------------------------------------------
# Configurable exclusions
# ----------------------------------------------------------------------------

EXCLUDED_DIRS=(
    "drafts"
    "templates"
)

# ----------------------------------------------------------------------------
# JSON Schema validation helper
# ----------------------------------------------------------------------------

validate_schema() {
    local json_file="$1"

    if [ ! -f "$json_file" ]; then
        echo "ERROR: File not found: $json_file"
        exit 1
    fi

    echo "==> Validating $(basename "$json_file")"

    local schema_url
    schema_url=$(grep -oP '"\$schema"\s*:\s*"\K[^"]+' "$json_file" || true)

    if [ -z "${schema_url}" ]; then
        echo "ERROR: $json_file does not declare a \$schema"
        exit 1
    fi

    local tmp_schema="/tmp/schema_$(date +%s%N).json"

    curl -fsSL "${schema_url}" -o "${tmp_schema}"
    ajv validate -s "${tmp_schema}" -d "${json_file}" --strict=true

    rm -f "${tmp_schema}"
}

# ----------------------------------------------------------------------------
# Pretty title helper
# ----------------------------------------------------------------------------

pretty_title() {
    local name="$1"

    name="${name%.md}"
    name="${name//-/ }"
    name="${name//_/ }"

    echo "$name" | awk '
    {
        for(i=1;i<=NF;i++) {
            $i=toupper(substr($i,1,1)) substr($i,2)
        }
        print
    }'
}

# ----------------------------------------------------------------------------
# Exclusion predicate builder
# ----------------------------------------------------------------------------

build_find_excludes() {
    local args=()

    for dir in "${EXCLUDED_DIRS[@]}"; do
        args+=(-not -path "*/${dir}/*")
    done

    echo "${args[@]}"
}

# ----------------------------------------------------------------------------
# Generate SUMMARY.md if missing or empty
# ----------------------------------------------------------------------------

generate_summary() {

    echo "==> Generating SUMMARY.md"

    local excludes
    excludes=$(build_find_excludes)

    {
        echo "# Summary"
        echo

        mapfile -t files < <(
            eval find "\"${BOOK_DIR}\"" \
                -type f \
                -name "\"*.md\"" \
                ! -name "\"SUMMARY.md\"" \
                ${excludes} \
                "|" sort
        )

        for file in "${files[@]}"; do
            [[ "$(basename "$file")" == "README.md" ]] || continue

            rel="${file#${BOOK_DIR}/}"
            title="$(pretty_title "$(basename "$(dirname "$file")")")"

            depth=$(awk -F/ '{print NF-1}' <<< "${rel}")

            indent=""
            for ((i=0; i<depth; i++)); do
                indent="${indent}  "
            done

            echo "${indent}- [${title}](${rel})"
        done

        for file in "${files[@]}"; do
            [[ "$(basename "$file")" == "README.md" ]] && continue

            rel="${file#${BOOK_DIR}/}"
            title="$(pretty_title "$(basename "$file")")"

            depth=$(awk -F/ '{print NF-1}' <<< "${rel}")

            indent=""
            for ((i=0; i<depth; i++)); do
                indent="${indent}  "
            done

            echo "${indent}- [${title}](${rel})"

        done

    } > "${SUMMARY_FILE}"
}

# ----------------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------------

echo "==> Starting documentation build"

# Validate manifest.json
if [ -f "${SRC_DIR}/manifest.json" ]; then
    validate_schema "${SRC_DIR}/manifest.json"
else
    echo "ERROR: manifest.json not found"
    exit 1
fi

# Validate documentation modules
echo "==> Scanning for documentation modules..."
find "${SRC_DIR}" -name "*.liaradoc.json" | while read -r module_json; do
    validate_schema "$module_json"
done

mkdir -p "${OUTPUT_DIR}"

# ----------------------------------------------------------------------------
# Shared assets
# ----------------------------------------------------------------------------

if [ -d /opt/docs-shared ]; then
    echo "==> Copying shared assets"

    mkdir -p "${SRC_DIR}/docs-shared/"
    cp -r \
        /opt/docs-shared/* \
        "${SRC_DIR}/docs-shared/" \
        || true
fi

# -----------------------------------------------------------------------------
# Process resources and replacements
# -----------------------------------------------------------------------------

if [ -f /usr/local/bin/processor.py ]; then
    echo "==> Running resource and replacement processors"
    python3 /usr/local/bin/processor.py
else
    echo "WARNING: processor.py not found, skipping resource and replacement processing"
fi

# ----------------------------------------------------------------------------
# Doxygen
# ----------------------------------------------------------------------------

if [ -f "${SRC_DIR}/Doxyfile" ]; then
    echo "==> Running Doxygen"

    mkdir -p "${DOXYGEN_GEN_DIR}"
    (cat "${SRC_DIR}/Doxyfile"; echo "OUTPUT_DIRECTORY = ${DOXYGEN_GEN_DIR}") | doxygen -

    if [ -d "${DOXYGEN_GEN_DIR}/html" ]; then
        cp -r "${DOXYGEN_GEN_DIR}/html" "${OUTPUT_DIR}/doxygen"
    else
        echo "WARNING: Doxygen HTML output not found in ${DOXYGEN_GEN_DIR}/html"
    fi
fi

# ----------------------------------------------------------------------------
# mdBook
# ----------------------------------------------------------------------------

if [ -f "${SRC_DIR}/book.toml" ]; then
    echo "==> Running mdBook"

    if [ ! -d "${BOOK_DIR}" ]; then
        echo "ERROR: docs directory not found: ${BOOK_DIR}"
        exit 1
    fi

    if [ ! -f "${SUMMARY_FILE}" ] || [ ! -s "${SUMMARY_FILE}" ]; then
        generate_summary
    fi

    mdbook build \
        "${SRC_DIR}" \
        --dest-dir "${OUTPUT_DIR}/book"
fi

# ----------------------------------------------------------------------------
# Additional outputs
# ----------------------------------------------------------------------------

if [ -n "${ADDITIONAL_DIRECTORIES_TO_OUTPUT:-}" ]; then
    echo "==> Copying additional directories to output"

    for dir in ${ADDITIONAL_DIRECTORIES_TO_OUTPUT}; do
        if [ -d "${SRC_DIR}/${dir}" ]; then
            cp -r "${SRC_DIR}/${dir}" "${OUTPUT_DIR}/${dir}"
        else
            echo "WARNING: Additional directory not found: ${SRC_DIR}/${dir}"
        fi
    done
fi

echo "==> Documentation build completed"
