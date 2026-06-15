/**
 * Liara Engine — Mermaid initialization
 *
 * Loaded after mermaid.min.js on mdBook pages. The mdbook-mermaid preprocessor
 * turns ```mermaid fences into <pre class="mermaid"> nodes; this renders them
 * with a theme that matches what the page is ACTUALLY showing.
 *
 * Why read the computed background instead of data-liara-theme?
 * Because when no theme has been chosen explicitly, that attribute is absent,
 * and guessing from prefers-color-scheme can disagree with the page (e.g. a
 * light page on a dark-mode OS). Reading the resolved --liara-bg-page colour
 * always matches what the reader sees. Diagrams also re-render live when the
 * theme is toggled.
 */
(function () {
    "use strict";

    if (!window.mermaid) return;
    const mermaid = window.mermaid;

    // --- Theme detection from the page's actual background -------------------

    function parseColor(s) {
        if (!s) return null;
        s = s.trim();
        let m;
        if ((m = s.match(/^#([0-9a-f]{3})$/i))) {
            return [
                parseInt(m[1][0] + m[1][0], 16),
                parseInt(m[1][1] + m[1][1], 16),
                parseInt(m[1][2] + m[1][2], 16)
            ];
        }
        if ((m = s.match(/^#([0-9a-f]{6})$/i))) {
            return [
                parseInt(m[1].slice(0, 2), 16),
                parseInt(m[1].slice(2, 4), 16),
                parseInt(m[1].slice(4, 6), 16)
            ];
        }
        if ((m = s.match(/^rgba?\(([^)]+)\)$/i))) {
            const p = m[1].split(",").map(function (x) {
                return parseFloat(x);
            });
            if (p.length >= 3) return [p[0], p[1], p[2]];
        }
        return null;
    }

    function pageIsDark() {
        const root = document.documentElement;
        let bg = getComputedStyle(root).getPropertyValue("--liara-bg-page").trim();
        if (!bg) bg = getComputedStyle(document.body).backgroundColor;
        const rgb = parseColor(bg);
        if (!rgb) return false;
        const lum = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
        return lum < 0.5;
    }

    function themeName() {
        return pageIsDark() ? "dark" : "default";
    }

    // --- Render -------------------------------------------------------------

    var nodes = Array.prototype.slice.call(
        document.querySelectorAll("pre.mermaid, .mermaid")
    );

    // Keep the original source so we can re-render on theme changes.
    nodes.forEach(function (el) {
        if (!el.hasAttribute("data-mermaid-src")) {
            el.setAttribute("data-mermaid-src", el.textContent);
        }
    });

    function renderAll() {
        if (!nodes.length) return;
        nodes.forEach(function (el) {
            el.removeAttribute("data-processed");
            el.innerHTML = el.getAttribute("data-mermaid-src");
        });
        mermaid.initialize({
            startOnLoad: false,
            theme: themeName(),
            securityLevel: "strict",
            fontFamily: "inherit"
        });
        try {
            mermaid.run({ nodes: nodes });
        } catch (e) {
            try { mermaid.init(undefined, nodes); } catch (e2) {}
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", renderAll);
    } else {
        renderAll();
    }

    // --- Re-render on theme changes -----------------------------------------

    new MutationObserver(function (muts) {
        for (let i = 0; i < muts.length; i++) {
            if (muts[i].attributeName === "data-liara-theme") {
                renderAll();
                return;
            }
        }
    }).observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-liara-theme"]
    });

    // The OS preference may change while no explicit choice is set.
    if (window.matchMedia) {
        const mq = window.matchMedia("(prefers-color-scheme: dark)");
        const onChange = function () {
            if (!document.documentElement.getAttribute("data-liara-theme")) {
                renderAll();
            }
        };
        if (mq.addEventListener) mq.addEventListener("change", onChange);
        else if (mq.addListener) mq.addListener(onChange);
    }
})();