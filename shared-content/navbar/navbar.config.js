/**
 * Liara Engine — Navbar configuration
 *
 * Centralized configuration for the shared documentation navbar.
 * Must be loaded BEFORE navbar.js — typically via a separate <script>
 * tag in the page <head>, ahead of the deferred navbar.js script.
 *
 * If this file fails to load (404, blocked, etc.), navbar.js falls back
 * to reasonable defaults computed from the current page origin.
 *
 * To override for a staging or alternate deployment, redefine
 * window.LIARA_NAVBAR_CONFIG in an inline script tag BEFORE this file
 * is included, or replace this file's contents.
 */
window.LIARA_NAVBAR_CONFIG = {

    /**
     * Base URL under which all module documentation is hosted.
     * Must end with a trailing slash. Module documentation URLs are
     * derived as:
     *
     *     {docsBaseUrl}{module.repo}/{version}/{book|doxygen}/...
     *
     * And per-module manifests are fetched from:
     *
     *     {docsBaseUrl}{module.repo}/manifest.json
     */
    docsBaseUrl: "https://liara-engine.liara-engine-documentation.workers.dev/",

    /**
     * Path to the modules registry JSON, relative to docsBaseUrl.
     * The registry lists known software modules so the navbar can
     * discover them.
     */
    modulesRegistryPath: "modules-registry.json"
};