# syntax=docker/dockerfile:1

# ============================================================================
# Liara Engine Documentation Builder
# ============================================================================
#
# Tools:
# - Doxygen 1.18.0
# - Node.js 24.20.0 (via NVM 0.39.6)
#
# Usage (run from the repository root — the build context must be the
# docs-shared checkout itself, since the baked assets below are copied
# straight out of it):
#
# docker buildx build -f Dockerfile -t liara-docs-builder .
#
# docker run --rm \
#   -u $(id -u):$(id -g) \
#   -v .:/src \
#   -e LIARA_DOCS_REPO="<your-repo-name>" \
#   -e LIARA_DOCS_VERSION="<your-docs-version>" \
#   -e LIARA_DOCS_SITE="<your-output-site-url>" \
#   -e LIARA_DOCS_ASSETS_PREFIX="/_cas/" \
#   liara-docs-builder
#
# ============================================================================

FROM debian:bookworm-slim

ARG DOXYGEN_VERSION=1.18.0
ARG NVM_VERSION=0.39.6
ARG NODE_VERSION=24.20.0

RUN apt-get update && apt-get install -y --no-install-recommends \
    bash \
    curl \
    graphviz \
    findutils \
    coreutils \
    python3 \
    ca-certificates \
    tar \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /tmp

# ----------------------------------------------------------------------------
# Download Doxygen
# ----------------------------------------------------------------------------
RUN curl -fsSL \
    "https://www.doxygen.nl/files/doxygen-${DOXYGEN_VERSION}.linux.bin.tar.gz" \
    -o doxygen.tar.gz \
    && tar -xzf doxygen.tar.gz \
    && mv "doxygen-${DOXYGEN_VERSION}" /opt/doxygen \
    && rm -f doxygen.tar.gz \
    && ln -s /opt/doxygen/bin/doxygen /usr/local/bin/doxygen

# ----------------------------------------------------------------------------
# Download Node.js via NVM
# ----------------------------------------------------------------------------
ENV NVM_DIR=/opt/nvm
RUN mkdir -p $NVM_DIR \
    && curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash \
    && . "$NVM_DIR/nvm.sh" \
    && nvm install ${NODE_VERSION} \
    && nvm alias default ${NODE_VERSION} \
    && chmod -R a+rx /opt/nvm \
    && ln -s "$NVM_DIR/versions/node/v${NODE_VERSION}/bin/node" /usr/local/bin/node \
    && ln -s "$NVM_DIR/versions/node/v${NODE_VERSION}/bin/npm" /usr/local/bin/npm \
    && ln -s "$NVM_DIR/versions/node/v${NODE_VERSION}/bin/npx" /usr/local/bin/npx

WORKDIR /

COPY tools/ /opt/liara/tools/
COPY build-docs.sh /usr/local/bin/build-docs

COPY astro/ /working/
COPY modules-registry.json /working/registry.json

RUN chmod +x /usr/local/bin/build-docs \
    && chmod +x /opt/liara/tools/* \
    && npm ci --prefix /working \
    && chown -R 1000:1000 /working \
    && chmod -R 755 /working

ENV NPM_CONFIG_CACHE=/tmp/.npm \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    ASTRO_TELEMETRY_DISABLED=1 \
    LIARA_TOOLS=/opt/liara/tools

WORKDIR /src

ENTRYPOINT ["build-docs"]
