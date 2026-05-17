/**
 * Liara Engine — Hub page script
 *
 * Populates the dynamic sections of the hub from `version.json`:
 *   1. The list of available versions in the "Versions" section.
 *   2. The current version label shown on each module card
 *      ("Core / dev", "Renderer / v0.1.0", etc.).
 *   3. The project status eyebrow ("Phase 0 — Bootstrap", or whatever
 *      `current_status` says in version.json).
 *
 * Failures (no network, malformed JSON) are non-fatal: the page already
 * renders correctly with the placeholder content from index.html. This
 * script merely upgrades the page when version data is available.
 *
 * The shared navbar (navbar.js) handles its own version dropdown
 * independently. This script does not interact with the navbar.
 */

(function () {
    "use strict";

    const VERSION_JSON_PATH = "./version.json";

    /**
     * Fetches version.json from the same origin. Returns null on any
     * failure so callers can skip the dynamic updates gracefully.
     */
    async function fetchVersionData() {
        try {
            const response = await fetch(VERSION_JSON_PATH, { cache: "default" });
            if (!response.ok) return null;
            const data = await response.json();
            if (!data || !Array.isArray(data.versions)) return null;
            return data;
        } catch (err) {
            console.warn("hub: version.json unavailable", err);
            return null;
        }
    }

    /**
     * Replaces the placeholder versions list with one entry per version
     * in `version.json`. The "current_dev" entry gets the
     * `hub-version--current` styling.
     */
    function renderVersionsList(versionData) {
        const container = document.querySelector("[data-liara-versions-list]");
        if (!container) return;

        // Clear the placeholder
        container.innerHTML = "";

        const currentDev = versionData.current_dev || "dev";
        const latest = versionData.latest || currentDev;

        for (const versionEntry of versionData.versions) {
            const link = document.createElement("a");
            link.className = "hub-version";
            if (versionEntry.label === currentDev) {
                link.classList.add("hub-version--current");
            }
            if (versionEntry.label === latest) {
                link.classList.add("hub-version--latest");
            }

            // Link to the user-guide for the chosen version by default;
            // it's the most user-facing landing page among the modules.
            const userUrl = versionEntry.modules && versionEntry.modules.user;
            link.href = userUrl || "#";

            const label = document.createElement("span");
            label.className = "hub-version__label";
            label.textContent = versionEntry.label;

            const note = document.createElement("span");
            note.className = "hub-version__note";
            note.textContent =
                versionEntry.label === currentDev ? "Current development" :
                    versionEntry.note || "Released";

            link.appendChild(label);
            link.appendChild(note);
            container.appendChild(link);
        }
    }

    /**
     * Updates the version chip on each module card to show the actual
     * current version (rather than the hardcoded "dev" placeholder).
     */
    function renderModuleCardVersions(versionData) {
        const currentDev = versionData.current_dev || "dev";
        const devEntry = versionData.versions.find(v => v.label === currentDev);
        if (!devEntry || !devEntry.modules) return;

        const chips = document.querySelectorAll("[data-liara-card-version]");
        chips.forEach(function (chip) {
            const moduleKey = chip.getAttribute("data-liara-module");
            if (devEntry.modules[moduleKey]) {
                chip.textContent = currentDev;
            }
        });
    }

    /**
     * Updates the status eyebrow at the top of the hero.
     */
    function renderStatus(versionData) {
        const statusText = document.querySelector("[data-liara-status-text]");
        if (!statusText || !versionData.current_status) return;
        statusText.textContent = versionData.current_status;
    }

    async function init() {
        const versionData = await fetchVersionData();
        if (!versionData) return;

        renderVersionsList(versionData);
        renderModuleCardVersions(versionData);
        renderStatus(versionData);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();