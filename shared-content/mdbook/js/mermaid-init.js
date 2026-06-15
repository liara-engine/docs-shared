/**
 * Liara Engine — Mermaid initialization
 *
 * Loaded after mermaid.min.js on mdBook pages. The mdbook-mermaid preprocessor
 * turns ```mermaid fences into <pre class="mermaid"> nodes; this picks a theme
 * matching the current Liara light/dark choice and renders them.
 *
 * Note: the theme is chosen once, at load. Toggling light/dark after load does
 * not recolor already-rendered diagrams until the page is reloaded.
 */
(function () {
    "use strict";

    if (!window.mermaid) return;

    function liaraMermaidTheme() {
        var explicit = document.documentElement.getAttribute("data-liara-theme");
        if (explicit === "dark") return "dark";
        if (explicit === "light") return "default";
        return window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: dark)").matches
            ? "dark"
            : "default";
    }

    window.mermaid.initialize({
        startOnLoad: true,
        theme: liaraMermaidTheme(),
        securityLevel: "strict",
        fontFamily: "inherit"
    });
})();