# ============================================================================
# Liara Engine Documentation Builder
# ============================================================================
#
# Tools:
# - Doxygen 1.17.0
# - mdBook 0.5.2
#
# Usage (run from the repository root — the build context must be the
# docs-shared checkout itself, since the baked assets below are copied
# straight out of it):
#
# docker buildx build -f docker/liara-documentation-builder/Dockerfile -t liara-docs-builder .
#
# docker run --rm \
#   -v $(pwd):/src \
#   -v $(pwd)/generated-docs:/docs \
#   liara-docs-builder
#
# ============================================================================
#
# This dockerfile is used to build the documentation for Liara Engine.
#
# It also bakes in docs-shared's own shared assets (the mdBook theme, the
# Doxygen header/footer, and the logo/favicon under shared-content/assets)
# straight from this repository's checkout. This Dockerfile lives inside
# docs-shared itself, so the image it produces always reflects exactly the
# templates committed alongside it — there is no separately versioned or
# downloaded copy to fall out of sync.
#
# To work as intended, you need to mount the source code of the engine to /src in the container.
# This folder need to contain the Doxyfile and book.toml files, which are used by doxygen and mdbook respectively to generate the documentation.
# The generated documentation will be output to the /docs folder in the container, which can be mounted to a local folder to access the generated documentation.
#
# ============================================================================

# ============================================================================
# STAGE 1 — Downloader
# ============================================================================

FROM debian:bookworm-slim AS downloader

ARG DOXYGEN_VERSION=1.17.0
ARG MDBOOK_VERSION=0.5.2
ARG MDBOOK_MERMAID_VERSION=0.17.0

WORKDIR /tmp

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    tar \
    && rm -rf /var/lib/apt/lists/*

# ----------------------------------------------------------------------------
# Download Doxygen
# ----------------------------------------------------------------------------

RUN curl -fsSL \
    "https://www.doxygen.nl/files/doxygen-${DOXYGEN_VERSION}.linux.bin.tar.gz" \
    -o doxygen.tar.gz \
    && tar -xzf doxygen.tar.gz \
    && mv "doxygen-${DOXYGEN_VERSION}" /opt/doxygen \
    && rm -f doxygen.tar.gz

# ----------------------------------------------------------------------------
# Download mdBook
# ----------------------------------------------------------------------------

RUN curl -fsSL \
    "https://github.com/rust-lang/mdBook/releases/download/v${MDBOOK_VERSION}/mdbook-v${MDBOOK_VERSION}-x86_64-unknown-linux-gnu.tar.gz" \
    -o mdbook.tar.gz \
    && tar -xzf mdbook.tar.gz \
    && chmod +x mdbook \
    && rm mdbook.tar.gz

# ----------------------------------------------------------------------------
# Download mdBook-mermaid
# ----------------------------------------------------------------------------
RUN curl -fsSL \
    "https://github.com/badboy/mdbook-mermaid/releases/download/v${MDBOOK_MERMAID_VERSION}/mdbook-mermaid-v${MDBOOK_MERMAID_VERSION}-x86_64-unknown-linux-gnu.tar.gz" \
    -o mdbook-mermaid.tar.gz \
    && tar -xzf mdbook-mermaid.tar.gz && chmod +x mdbook-mermaid && rm mdbook-mermaid.tar.gz

# ============================================================================
# STAGE 2 — Runtime
# ============================================================================


FROM debian:bookworm-slim

LABEL org.opencontainers.image.title="Liara Documentation Builder"
LABEL org.opencontainers.image.description="Ultra-light CI documentation builder"
LABEL org.opencontainers.image.licenses="MIT"

ENV SRC_DIR=/src
ENV OUTPUT_DIR=/docs
ENV MDBOOK_SOURCE_DIR=/src/docs
ENV DOXYGEN_GEN_DIR=/src/build/doxygen
ENV ADDITIONAL_DIRECTORIES_TO_OUTPUT=""

WORKDIR /

# ----------------------------------------------------------------------------
# Runtime packages only
# ----------------------------------------------------------------------------


RUN apt-get update && apt-get install -y --no-install-recommends \
    bash \
    curl \
    graphviz \
    findutils \
    coreutils \
    python3 \
    nodejs \
    npm \
    && npm install -g ajv-cli@5 ajv@8 \
    && rm -rf /var/lib/apt/lists/*

# ----------------------------------------------------------------------------
# Copy binaries and assets
# ----------------------------------------------------------------------------

COPY --from=downloader /opt/doxygen /opt/doxygen
COPY --from=downloader /tmp/mdbook /usr/local/bin/mdbook
COPY --from=downloader /tmp/mdbook-mermaid /usr/local/bin/mdbook-mermaid

# The baked docs-shared templates — copied straight from the build context
# (this same checkout) instead of a pinned download, so the image is always
# in lockstep with the commit/tag it's built from. Kept in sync by hand with
# what build-docs stages under ${SRC_DIR}/docs-shared/: the mdBook theme,
# the Doxygen header/footer, and the assets referenced at build time (e.g.
# a module's `PROJECT_ICON = docs-shared/shared-content/assets/logo.svg`).
COPY mdbook/ /opt/docs-shared/mdbook/
COPY doxygen/ /opt/docs-shared/doxygen/
COPY shared-content/assets/ /opt/docs-shared/shared-content/assets/

COPY docker/scripts/processor.py /usr/local/bin/processor.py
COPY docker/scripts/resource_processor.py /usr/local/bin/resource_processor.py
COPY docker/scripts/replacement_processor.py /usr/local/bin/replacement_processor.py

COPY docker/scripts/build-docs.sh /usr/local/bin/build-docs

RUN ln -s /opt/doxygen/bin/doxygen /usr/local/bin/doxygen \
    && chmod +x /usr/local/bin/mdbook \
    && chmod +x /usr/local/bin/mdbook-mermaid \
    && chmod +x /usr/local/bin/build-docs \
    && chmod +x /usr/local/bin/processor.py \
    && chmod +x /usr/local/bin/resource_processor.py \
    && chmod +x /usr/local/bin/replacement_processor.py

WORKDIR ${SRC_DIR}

ENTRYPOINT ["build-docs"]