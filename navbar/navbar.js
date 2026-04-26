/**
 * Liara Engine — Navbar logic
 *
 * Handles four concerns:
 *   1. Theme cycling (system -> light -> dark -> system) with persistence
 *   2. Dyslexia-friendly mode toggle with persistence
 *   3. Version dropdown population from version.json
 *   4. Active-module highlighting based on the current URL
 *
 * Design philosophy:
 *   - All preference detection runs synchronously, BEFORE DOMContentLoaded,
 *     to prevent flash of unstyled content (FOUC).
 *   - The navbar's HTML is in the DOM at parse time (it's a static fragment,
 *     not injected by JS), so we only need to wire up event handlers and
 *     fetch the version list.
 *   - Failures are non-fatal: if version.json is unreachable, the version
 *     selector simply shows only "dev" and a placeholder; navigation
 *     continues to work.
 *
 * Storage keys:
 *   - liara-theme: "light" | "dark" | absent (= follow system)
 *   - liara-a11y-dyslexia: "true" | absent (= disabled)
 */

(function () {
    "use strict";

    // ========================================================================
    // Storage keys and defaults
    // ========================================================================

    const STORAGE_THEME = "liara-theme";
    const STORAGE_A11Y_DYSLEXIA = "liara-a11y-dyslexia";

    const VERSION_JSON_URL = "https://liara-engine.github.io/version.json";

    // Module slug -> URL fragment used in deployed paths.
    // The `null` value for "user" means the user guide lives directly under
    // the meta repository's docs root, not in a per-module subdirectory.
    const MODULE_SLUGS = {
        user:       "user",
        interfaces: "liara-interfaces",
        core:       "liara-core",
        renderer:   "liara-renderer",
        editor:     "liara-editor",
        physics:    "liara-physics",
    };

    const KNOWN_MODULES = Object.keys(MODULE_SLUGS);

    // ========================================================================
    // Theme management
    // ========================================================================

    /**
     * Returns the currently stored theme preference, or null if the user has
     * not made an explicit choice (in which case the system preference is
     * followed).
     */
    function getStoredTheme() {
        try {
            const value = localStorage.getItem(STORAGE_THEME);
            return value === "light" || value === "dark" ? value : null;
        } catch (e) {
            return null;
        }
    }

    /**
     * Applies a theme preference to the document root. Pass null to clear
     * the preference and follow the system.
     */
    function applyTheme(theme) {
        const root = document.documentElement;
        if (theme === "light" || theme === "dark") {
            root.setAttribute("data-liara-theme", theme);
        } else {
            root.removeAttribute("data-liara-theme");
        }
    }

    function persistTheme(theme) {
        try {
            if (theme === "light" || theme === "dark") {
                localStorage.setItem(STORAGE_THEME, theme);
            } else {
                localStorage.removeItem(STORAGE_THEME);
            }
        } catch (e) {
            /* localStorage may be unavailable (private mode); silently ignore */
        }
    }

    /**
     * Cycles theme: system -> light -> dark -> system -> ...
     */
    function cycleTheme() {
        const current = getStoredTheme();
        const next =
            current === null ? "light" :
                current === "light" ? "dark" :
                    null;

        applyTheme(next);
        persistTheme(next);
        announceThemeChange(next);
    }

    function announceThemeChange(theme) {
        const label =
            theme === null ? "Following system theme" :
                theme === "light" ? "Light theme active" :
                    "Dark theme active";

        // Accessible announcement via aria-live region. The region is created
        // lazily because most pages won't need it.
        let liveRegion = document.getElementById("liara-navbar-announcer");
        if (!liveRegion) {
            liveRegion = document.createElement("div");
            liveRegion.id = "liara-navbar-announcer";
            liveRegion.setAttribute("role", "status");
            liveRegion.setAttribute("aria-live", "polite");
            liveRegion.style.cssText =
                "position:absolute;width:1px;height:1px;padding:0;margin:-1px;" +
                "overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;";
            document.body.appendChild(liveRegion);
        }
        liveRegion.textContent = label;
    }

    // ========================================================================
    // Dyslexia-friendly mode
    // ========================================================================

    function getStoredA11yDyslexia() {
        try {
            return localStorage.getItem(STORAGE_A11Y_DYSLEXIA) === "true";
        } catch (e) {
            return false;
        }
    }

    function applyA11yDyslexia(enabled) {
        const root = document.documentElement;
        if (enabled) {
            root.setAttribute("data-liara-a11y-dyslexia", "true");
        } else {
            root.removeAttribute("data-liara-a11y-dyslexia");
        }
    }

    function persistA11yDyslexia(enabled) {
        try {
            if (enabled) {
                localStorage.setItem(STORAGE_A11Y_DYSLEXIA, "true");
            } else {
                localStorage.removeItem(STORAGE_A11Y_DYSLEXIA);
            }
        } catch (e) {
            /* ignore */
        }
    }

    function toggleA11yDyslexia() {
        const next = !getStoredA11yDyslexia();
        applyA11yDyslexia(next);
        persistA11yDyslexia(next);

        const button = document.querySelector("[data-liara-a11y-toggle]");
        if (button) {
            button.setAttribute("aria-pressed", next ? "true" : "false");
        }
    }

    // ========================================================================
    // URL parsing: which module/version is currently being viewed?
    // ========================================================================

    /**
     * Parses the current URL to determine the active module and version.
     * Returns { module: string|null, version: string|null }.
     *
     * Expected URL patterns on liara-engine.github.io:
     *   - /                                  -> hub home
     *   - /<module>/<version>/...            -> module docs at version
     *   - /user/<version>/...                -> user guide at version
     *
     * Anything else returns nulls and the navbar falls back to defaults.
     */
    function detectCurrentLocation() {
        const segments = window.location.pathname.split("/").filter(Boolean);
        if (segments.length === 0) {
            return { module: null, version: null };
        }

        // Try to match the first segment to a known module slug.
        for (const [moduleKey, slug] of Object.entries(MODULE_SLUGS)) {
            if (segments[0] === slug) {
                return {
                    module: moduleKey,
                    version: segments[1] || null,
                };
            }
        }

        return { module: null, version: null };
    }

    /**
     * Returns the canonical URL for a (module, version) pair, used to
     * rewrite navbar links when the user picks a different version.
     */
    function buildModuleUrl(module, version) {
        const slug = MODULE_SLUGS[module];
        if (!slug) return null;
        return `https://liara-engine.github.io/${slug}/${version}/`;
    }

    // ========================================================================
    // Version dropdown
    // ========================================================================

    /**
     * Fetches version.json from the hub. Returns null on any failure;
     * callers should treat null as "no version data available".
     */
    async function fetchVersionList() {
        try {
            const response = await fetch(VERSION_JSON_URL, { cache: "default" });
            if (!response.ok) return null;
            const data = await response.json();
            if (!data || !Array.isArray(data.versions)) return null;
            return data;
        } catch (err) {
            // Network error, CORS, JSON parse error — all non-fatal.
            console.warn("liara-navbar: version.json unavailable", err);
            return null;
        }
    }

    /**
     * Populates the version dropdown menu and wires up its toggle behavior.
     */
    function setupVersionMenu(versionData, currentLocation) {
        const trigger = document.querySelector(".liara-navbar__version-trigger");
        const menu = document.querySelector("[data-liara-version-menu]");
        const label = document.querySelector("[data-liara-version-label]");
        if (!trigger || !menu || !label) return;

        // Determine which version is "current" for display purposes.
        const currentVersion = currentLocation.version || "dev";
        label.textContent = currentVersion;

        // If we got no version data, the dropdown still works but only shows
        // the current entry. Better than nothing.
        const versions = versionData ? versionData.versions : [{ label: currentVersion }];

        // Build menu items. Each item, when clicked, navigates to the same
        // module's docs at the chosen version (or to the hub if no module
        // is currently active).
        menu.innerHTML = "";
        for (const versionEntry of versions) {
            const li = document.createElement("li");
            const a = document.createElement("a");
            a.textContent = versionEntry.label;

            if (currentLocation.module && versionEntry.modules
                && versionEntry.modules[currentLocation.module]) {
                a.href = versionEntry.modules[currentLocation.module];
            } else if (currentLocation.module) {
                // No entry for this module at this version — fall back to the
                // module's hub. Better than a broken link.
                a.href = buildModuleUrl(currentLocation.module, versionEntry.label);
            } else {
                a.href = "https://liara-engine.github.io/";
            }

            if (versionEntry.label === currentVersion) {
                a.classList.add("is-current");
            }

            li.appendChild(a);
            menu.appendChild(li);
        }

        // Open / close behavior
        function openMenu() {
            menu.hidden = false;
            trigger.setAttribute("aria-expanded", "true");
        }
        function closeMenu() {
            menu.hidden = true;
            trigger.setAttribute("aria-expanded", "false");
        }

        trigger.addEventListener("click", function (e) {
            e.stopPropagation();
            const isOpen = !menu.hidden;
            if (isOpen) closeMenu(); else openMenu();
        });

        // Close on outside click
        document.addEventListener("click", function (e) {
            if (!menu.hidden && !menu.contains(e.target) && e.target !== trigger) {
                closeMenu();
            }
        });

        // Close on Escape
        document.addEventListener("keydown", function (e) {
            if (e.key === "Escape" && !menu.hidden) {
                closeMenu();
                trigger.focus();
            }
        });
    }

    // ========================================================================
    // Active module highlighting
    // ========================================================================

    function highlightActiveModule(currentModule) {
        if (!currentModule) return;
        const link = document.querySelector(
            `.liara-navbar__module[data-liara-module="${currentModule}"]`
        );
        if (link) {
            link.classList.add("is-active");
            link.setAttribute("aria-current", "page");
        }
    }

    // ========================================================================
    // GitHub link adjustment
    // ========================================================================

    /**
     * Points the GitHub link at the repository for the currently viewed
     * module. Falls back to the meta repository when no specific module
     * is active.
     */
    function updateGitHubLink(currentModule) {
        const link = document.querySelector("[data-liara-github]");
        if (!link) return;

        const slug = currentModule ? MODULE_SLUGS[currentModule] : "liara";
        if (slug && slug !== "user") {
            link.href = `https://github.com/liara-engine/${slug}`;
        }
    }

    // ========================================================================
    // Mobile menu toggle
    // ========================================================================

    function setupMobileMenu() {
        const toggle = document.querySelector("[data-liara-menu-toggle]");
        const navbar = document.getElementById("liara-navbar");
        if (!toggle || !navbar) return;

        toggle.addEventListener("click", function () {
            const isOpen = navbar.classList.toggle("is-open");
            toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
            toggle.setAttribute("aria-label", isOpen ? "Close menu" : "Open menu");
        });

        // Close the mobile menu when a link inside it is clicked.
        navbar.querySelectorAll(".liara-navbar__module").forEach(function (link) {
            link.addEventListener("click", function () {
                navbar.classList.remove("is-open");
                toggle.setAttribute("aria-expanded", "false");
                toggle.setAttribute("aria-label", "Open menu");
            });
        });
    }

    // ========================================================================
    // Scroll shadow
    // ========================================================================

    /**
     * Adds a subtle shadow to the navbar once the page has scrolled, to
     * separate it visually from the content sliding behind.
     */
    function setupScrollShadow() {
        const navbar = document.getElementById("liara-navbar");
        if (!navbar) return;

        let ticking = false;
        function update() {
            const scrolled = window.scrollY > 0;
            navbar.classList.toggle("is-scrolled", scrolled);
            ticking = false;
        }

        window.addEventListener("scroll", function () {
            if (!ticking) {
                window.requestAnimationFrame(update);
                ticking = true;
            }
        }, { passive: true });

        update();
    }

    // ========================================================================
    // FOUC prevention: apply preferences synchronously, before DOMContentLoaded
    // ========================================================================

    applyTheme(getStoredTheme());
    applyA11yDyslexia(getStoredA11yDyslexia());

    // ========================================================================
    // Init
    // ========================================================================

    function init() {
        // Wire theme toggle
        const themeToggle = document.querySelector("[data-liara-theme-toggle]");
        if (themeToggle) {
            themeToggle.addEventListener("click", cycleTheme);
        }

        // Wire a11y toggle
        const a11yToggle = document.querySelector("[data-liara-a11y-toggle]");
        if (a11yToggle) {
            a11yToggle.setAttribute(
                "aria-pressed",
                getStoredA11yDyslexia() ? "true" : "false"
            );
            a11yToggle.addEventListener("click", toggleA11yDyslexia);
        }

        // Detect where we are
        const location = detectCurrentLocation();
        highlightActiveModule(location.module);
        updateGitHubLink(location.module);

        // Mobile menu and scroll shadow
        setupMobileMenu();
        setupScrollShadow();

        // Version dropdown — fetch async, populate when ready.
        fetchVersionList().then(function (versionData) {
            setupVersionMenu(versionData, location);
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();