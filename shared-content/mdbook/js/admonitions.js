/**
 * Liara Engine — mdBook admonitions enhancement
 *
 * Scans the rendered page for "labeled blockquotes" of the form:
 *
 *     > **Note:** This is an informational callout.
 *
 * Detects the leading `**Label:**` strong tag, maps it to a semantic
 * variant (info / success / warning / danger), and decorates the
 * blockquote with the matching CSS class plus a small inline SVG icon.
 *
 * The base styling (info-style) lives in custom.css. The variant styles
 * (`.liara-admonition--success`, etc.) also live there. This file only
 * applies the classes; it does not contain any styling itself.
 *
 * Recognized labels (case-insensitive, with or without trailing colon):
 *
 *   info      "Note", "Info", "See"
 *   success   "Tip", "Hint", "Success"
 *   warning   "Warning", "Caution", "Important"
 *   danger    "Danger", "Error", "Deprecated"
 *
 * Unknown labels leave the blockquote with the base info style.
 */

(function () {
    "use strict";

    /* Maps the lowercased, colon-stripped label text to a variant class. */
    const LABEL_MAP = {
        "note":       "info",
        "info":       "info",
        "see":        "info",
        "see also":   "info",

        "tip":        "success",
        "hint":       "success",
        "success":    "success",

        "warning":    "warning",
        "caution":    "warning",
        "important":  "warning",
        "attention":  "warning",

        "danger":     "danger",
        "error":      "danger",
        "deprecated": "danger",
        "bug":        "danger"
    };

    /* Inline SVG icons (Feather-like, 16×16, currentColor stroke). */
    const ICONS = {
        info:    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
        success: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
        warning: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
        danger:  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>'
    };

    /**
     * Returns the variant class for a strong element if its text starts
     * with a known label, or null otherwise.
     */
    function detectVariant(strongElement) {
        const raw = strongElement.textContent || "";
        // Strip a trailing colon and any trailing whitespace.
        const cleaned = raw.replace(/:\s*$/, "").trim().toLowerCase();
        return LABEL_MAP[cleaned] || null;
    }

    /**
     * Decorates a single blockquote: adds the appropriate classes and
     * injects the icon. Idempotent — calling twice on the same element
     * has no further effect.
     */
    function decorateBlockquote(blockquote) {
        if (blockquote.classList.contains("liara-admonition")) return;

        // The label must be the first <strong> inside the first <p>
        // inside the blockquote. Anything else is a regular blockquote.
        const firstP = blockquote.querySelector(":scope > p:first-child");
        if (!firstP) return;

        const firstStrong = firstP.querySelector("strong:first-child");
        if (!firstStrong) return;

        // The strong must be the very first node in the paragraph for the
        // pattern to apply. If there is text before it (e.g., "Quote: **Note**")
        // we leave the blockquote as a generic info admonition.
        if (firstP.firstChild !== firstStrong) return;

        const variant = detectVariant(firstStrong);
        if (!variant) return;

        blockquote.classList.add("liara-admonition", "liara-admonition--" + variant);

        // Inject the icon as the first child of the strong tag, so the
        // label text remains intact and screen readers continue to read
        // it correctly. The icon is aria-hidden because the label text
        // already conveys the meaning.
        const iconWrapper = document.createElement("span");
        iconWrapper.className = "liara-admonition__icon";
        iconWrapper.innerHTML = ICONS[variant];
        iconWrapper.setAttribute("aria-hidden", "true");
        firstStrong.insertBefore(iconWrapper, firstStrong.firstChild);
    }

    /**
     * Scans the page for all blockquotes inside the main content area and
     * decorates the labeled ones.
     */
    function decorateAll() {
        // mdBook wraps content in #content; we limit the scan to that area
        // so we don't accidentally decorate nav/footer blockquotes.
        const root = document.getElementById("content") || document.body;
        const blockquotes = root.querySelectorAll("blockquote");
        blockquotes.forEach(decorateBlockquote);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", decorateAll);
    } else {
        decorateAll();
    }
})();