/**
 * Liara Engine — Navbar logic (v2.3)
 *
 * Responsibilities, in execution order:
 *
 *   1. Apply theme and a11y preferences synchronously (FOUC prevention).
 *   2. Wire static handlers: theme toggle, a11y toggle, mobile menu,
 *      scroll shadow.
 *   3. Parse the current URL to detect which module, which version, and
 *      which view (book / doxygen) we are looking at.
 *   4. Fetch the modules registry and, in parallel, every module's
 *      manifest.json.
 *   5. Compute the current "ABI horizon": the set of ABI versions
 *      compatible with the version we're viewing. If we're on the ABI
 *      itself, that's just our current version.
 *   6. Render one pill per module, populated with its versions and
 *      compatibility badges based on the ABI horizon.
 *   7. Render the contextual sub-nav (book vs doxygen tabs) when on a
 *      module page; keep it hidden otherwise (or if the module restricts the view).
 *
 * All failures are non-fatal. If the registry can't be fetched, the
 * modules list stays empty. If a manifest is missing, that module is
 * still listed but without compatibility info (badges show "unknown").
 *
 * Manifest schema versions:
 *
 *   Both `module-manifest.schema.json` (v1) and `module-manifest-v2.schema.json`
 *   (v2) are supported side by side — see `normalizeVersionEntry` and
 *   `effectiveModuleRole` below. A manifest is v2 when it carries
 *   `manifest_version: 2`; its absence means v1. v1 manifests are read
 *   exactly as before (`versions[x].abi_compatibility`, and the module's
 *   ABI/meta role comes only from the registry's `is_abi`/`meta` flags).
 *   v2 manifests additionally carry `kind`, which — when present — takes
 *   precedence over those registry flags, and versions may carry a
 *   human-readable `note` that is surfaced in the version dropdown.
 *   This lets modules migrate to v2 independently and at their own pace.
 *
 * Storage keys (carried over from v1):
 *   - liara-theme: "light" | "dark" | absent (= follow system)
 *   - liara-a11y-dyslexia: "true" | absent (= disabled)
 */

(function () {
    "use strict";

    /* ========================================================================
     * Configuration
     * ====================================================================== */

    function getConfig() {
        const fallback = {
            docsBaseUrl: window.location.origin + "/",
            modulesRegistryPath: "modules-registry.json"
        };
        const user = window.LIARA_NAVBAR_CONFIG || {};
        return {
            docsBaseUrl: user.docsBaseUrl || fallback.docsBaseUrl,
            modulesRegistryPath: user.modulesRegistryPath || fallback.modulesRegistryPath
        };
    }

    const STORAGE_THEME = "liara-theme";
    const STORAGE_A11Y_DYSLEXIA = "liara-a11y-dyslexia";

    /* ========================================================================
     * Theme + a11y management (carried over from v1)
     * ====================================================================== */

    function getStoredTheme() {
        try {
            const v = localStorage.getItem(STORAGE_THEME);
            return v === "light" || v === "dark" ? v : null;
        } catch (e) { return null; }
    }

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
        } catch (e) { /* private mode */ }
    }

    function cycleTheme() {
        const current = getStoredTheme();
        const next = current === null ? "light" : current === "light" ? "dark" : null;
        applyTheme(next);
        persistTheme(next);
        announceLive(
            next === null ? "Following system theme" :
                next === "light" ? "Light theme active" :
                    "Dark theme active"
        );
    }

    function getStoredA11yDyslexia() {
        try { return localStorage.getItem(STORAGE_A11Y_DYSLEXIA) === "true"; }
        catch (e) { return false; }
    }

    function applyA11yDyslexia(enabled) {
        const root = document.documentElement;
        if (enabled) root.setAttribute("data-liara-a11y-dyslexia", "true");
        else root.removeAttribute("data-liara-a11y-dyslexia");
    }

    function persistA11yDyslexia(enabled) {
        try {
            if (enabled) localStorage.setItem(STORAGE_A11Y_DYSLEXIA, "true");
            else localStorage.removeItem(STORAGE_A11Y_DYSLEXIA);
        } catch (e) { /* ignore */ }
    }

    function toggleA11yDyslexia() {
        const next = !getStoredA11yDyslexia();
        applyA11yDyslexia(next);
        persistA11yDyslexia(next);
        const button = document.querySelector("[data-liara-a11y-toggle]");
        if (button) button.setAttribute("aria-pressed", next ? "true" : "false");
    }

    /** Accessible live region for screen reader announcements. */
    function announceLive(message) {
        let region = document.getElementById("liara-navbar-announcer");
        if (!region) {
            region = document.createElement("div");
            region.id = "liara-navbar-announcer";
            region.setAttribute("role", "status");
            region.setAttribute("aria-live", "polite");
            region.style.cssText =
                "position:absolute;width:1px;height:1px;padding:0;margin:-1px;" +
                "overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;";
            document.body.appendChild(region);
        }
        region.textContent = message;
    }

    /* ========================================================================
     * URL parsing
     *
     * Expected URL structure on the deployed docs:
     *
     *     {docsBaseUrl}{repo}/{version}/{book|doxygen}/{rest}
     *
     * The hub lives at {docsBaseUrl}hub/ (or at the origin root,
     * depending on the deployment). Anything that doesn't match a known
     * repo is treated as "no module context".
     * ====================================================================== */

    function parseLocation(registry) {
        const segments = window.location.pathname.split("/").filter(Boolean);
        if (segments.length === 0 || !registry) {
            return { module: null, version: null, view: null };
        }

        const module = registry.modules.find(m => m.repo === segments[0]);
        if (!module) {
            return { module: null, version: null, view: null };
        }

        const version = segments[1] || null;
        let view = segments[2];

        if (!view) {
            if (module.only_doxygen) view = "doxygen";
            else view = "book";
        }

        return { module, version, view };
    }

    /* ========================================================================
     * Fetching: registry + manifests
     * ====================================================================== */

    async function fetchJson(url) {
        try {
            const response = await fetch(url, { cache: "default" });
            if (!response.ok) return null;
            return await response.json();
        } catch (err) {
            console.warn("liara-navbar: failed to fetch " + url, err);
            return null;
        }
    }

    async function fetchRegistry(config) {
        const url = config.docsBaseUrl + config.modulesRegistryPath;
        const data = await fetchJson(url);
        if (!data || !Array.isArray(data.modules)) return null;
        return data;
    }

    async function fetchAllManifests(registry, config) {
        const promises = registry.modules.map(async (module) => {
            const url = config.docsBaseUrl + module.repo + "/manifest.json";
            const manifest = await fetchJson(url);
            return Object.assign({}, module, { manifest });
        });
        return await Promise.all(promises);
    }

    /* ========================================================================
     * Manifest v1 / v2 compatibility layer
     *
     * v1 versions look like:      { "abi_compatibility": ["dev"] }
     * v2 versions look like:      "dev" | ["dev", "1.0.0"]
     *                        or:  { "abi": "dev" | [...], "note": "..." }
     * v2 "contract"/"infrastructure" versions carry no `abi` at all — just
     * an optional `note`.
     * ====================================================================== */

    /**
     * Normalizes any version-entry shape (v1 or v2) into
     * { abi: string[] | null, note: string | undefined }.
     */
    function normalizeVersionEntry(raw) {
        if (raw === undefined || raw === null) return { abi: null, note: undefined };

        // v2 shorthand: a bare ABI version, or an array of them.
        if (typeof raw === "string") return { abi: [raw], note: undefined };
        if (Array.isArray(raw)) return { abi: raw, note: undefined };

        // v1: always an object with `abi_compatibility`.
        if ("abi_compatibility" in raw) {
            return { abi: raw.abi_compatibility || [], note: undefined };
        }

        // v2 object form: { abi?: string | string[], note?: string }.
        let abi = raw.abi;
        if (typeof abi === "string") abi = [abi];
        return { abi: abi || null, note: raw.note };
    }

    /** Looks up and normalizes a module's version entry, v1 or v2 alike. */
    function getVersionEntry(manifest, version) {
        if (!manifest || !manifest.versions) return null;
        const raw = manifest.versions[version];
        if (raw === undefined) return null;
        return normalizeVersionEntry(raw);
    }

    /**
     * A module's ABI role: is it the ABI itself ("contract" in v2 /
     * `is_abi` in the registry), pure meta-documentation with no ABI
     * relation ("infrastructure" / `meta`), or a normal ABI-consuming
     * module ("module"/"host" / neither flag)?
     *
     * A v2 manifest's `kind` — when present — takes precedence over the
     * registry's `is_abi`/`meta` flags, so a module's own manifest becomes
     * the source of truth as soon as it migrates. v1 manifests carry no
     * `kind`, so they keep relying on the registry entry exactly as before.
     */
    function effectiveModuleRole(module) {
        const manifest = module && module.manifest;
        if (manifest && manifest.kind) {
            return {
                isAbi: manifest.kind === "contract",
                meta: manifest.kind === "infrastructure"
            };
        }
        return {
            isAbi: !!(module && module.is_abi),
            meta: !!(module && module.meta)
        };
    }

    /* ========================================================================
     * ABI compatibility computation
     * ====================================================================== */

    /**
     * The "ABI horizon" is the set of ABI versions compatible with the
     * version we're currently viewing.
     *
     *   - If we're on the ABI itself, the horizon is just the current
     *     version: only modules whose ABI compatibility contains that
     *     version are compatible.
     *   - If we're on another module, the horizon is the ABI compatibility
     *     of that module's current version.
     *   - If we're nowhere in particular (hub, etc.), the horizon is
     *     null, meaning compatibility cannot be determined.
     */
    function computeAbiHorizon(currentModule, currentVersion) {
        if (!currentModule || !currentVersion) return null;
        const role = effectiveModuleRole(currentModule);
        if (role.meta) return null;
        if (role.isAbi) return [currentVersion];
        if (!currentModule.manifest) return null;
        const entry = getVersionEntry(currentModule.manifest, currentVersion);
        if (!entry) return null;
        return entry.abi || [];
    }

    /**
     * Parses a dotted version string into {major, minor, patch}, or null if
     * it isn't one (e.g. "dev"). Mirrors what the ABI's own
     * LIARA_VERSION_MAJOR/MINOR macros read off a real version number.
     */
    function parseSemver(v) {
        if (typeof v !== "string") return null;
        const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v);
        if (!m) return null;
        return { major: +m[1], minor: +m[2], patch: +m[3] };
    }

    /**
     * Mirrors `liara_version_provides()` from the ABI itself, so the badge
     * the site shows can never claim something the ABI's own rule wouldn't:
     * identical versions are "exact"; differing majors are "incompatible";
     * a 0.0.x version on either side demands exact equality and is
     * otherwise "incompatible"; an older provided minor is "degraded";
     * anything else is "compatible".
     *
     * One addition on top of the C function: a manifest is only ever meant
     * to declare major- (or, for 0.x, minor-) level precision — see
     * `docs/authoring-a-module.md` — so patch is normally irrelevant and
     * every patch of an otherwise-matching major.minor is "compatible",
     * exactly like the ABI function (which never looks at patch beyond the
     * initial equality check). But a manifest MAY declare a specific patch
     * (e.g. "0.2.1" instead of "0.2.0") to mean "requires at least that
     * patch" — when major.minor already tie, we then break the tie on
     * patch the same way the ABI breaks it on minor: an older provided
     * patch is "degraded", an equal-or-newer one is "compatible".
     *
     * Non-parseable strings (e.g. "dev") are only ever "exact" (on literal
     * string equality) or "incompatible" — there's no numeric rule to fall
     * back on.
     */
    function compareAbiVersions(providedStr, requiredStr) {
        if (providedStr === requiredStr) return "exact";

        const provided = parseSemver(providedStr);
        const required = parseSemver(requiredStr);
        if (!provided || !required) return "incompatible";

        if (provided.major !== required.major) return "incompatible";

        if ((provided.major === 0 && provided.minor === 0)
            || (required.major === 0 && required.minor === 0)) {
            return "incompatible";
        }

        if (provided.minor < required.minor) return "degraded";
        if (provided.minor > required.minor) return "compatible";

        return provided.patch < required.patch ? "degraded" : "compatible";
    }

    const COMPAT_RANK = { exact: 3, compatible: 2, degraded: 1, incompatible: 0 };

    /** Best compatibility of `providedStr` against any one of `requiredList`. */
    function bestCompat(providedStr, requiredList) {
        let best = "incompatible";
        for (const requiredStr of requiredList) {
            const result = compareAbiVersions(providedStr, requiredStr);
            if (COMPAT_RANK[result] > COMPAT_RANK[best]) best = result;
        }
        return best;
    }

    /** Collapses a compareAbiVersions() result into a badge status. */
    function toBadgeStatus(compat) {
        if (compat === "exact" || compat === "compatible") return "compatible";
        if (compat === "degraded") return "degraded";
        return "mismatch";
    }

    /**
     * For a given (module, version), returns one of:
     *     "compatible"   — the version is compatible with the ABI horizon
     *     "degraded"     — compatible with reduced functionality (older minor/patch)
     *     "mismatch"     — incompatible
     *     "unknown"      — no data available (manifest missing, etc.)
     *     "meta"         — target module is meta-documentation (no ABI check)
     *     "meta-current" — target module is meta-documentation and currently viewed
     *     "none"         — no compatibility badge at all (e.g. browsing a meta section)
     */
    function evaluateCompat(targetModule, targetVersion, abiHorizon,
                            currentModule, currentVersion) {

        const targetRole = effectiveModuleRole(targetModule);

        // The version we're currently viewing gets a "current" badge.
        if (currentModule && targetModule.key === currentModule.key
            && targetVersion === currentVersion) {
            return targetRole.meta ? "meta-current" : "current";
        }

        // If the target module itself is a meta-documentation module, it has no ABI constraints
        if (targetRole.meta) {
            return "meta";
        }

        // If we are currently visiting a meta module, we hide compatibility for all other modules
        if (currentModule && effectiveModuleRole(currentModule).meta) {
            return "none";
        }

        if (abiHorizon === null) return "unknown";

        // computeAbiHorizon() sets abiHorizon = [currentVersion] precisely
        // when currentModule is the ABI itself — i.e. a single concrete,
        // "provided" ABI release, as opposed to a set of declared
        // requirements. That distinction tells us which side of
        // compareAbiVersions()'s provided/required each value plays.
        const currentIsAbi = !!(currentModule && effectiveModuleRole(currentModule).isAbi);

        if (targetRole.isAbi) {
            if (currentIsAbi) {
                // Two concrete ABI releases: is targetVersion new enough
                // to stand in for the one we're viewing?
                return toBadgeStatus(compareAbiVersions(targetVersion, currentVersion));
            }
            // currentModule's own declared ABI requirement(s): is this
            // concrete ABI release new enough for them?
            return toBadgeStatus(bestCompat(targetVersion, abiHorizon));
        }

        if (!targetModule.manifest) return "unknown";
        const entry = getVersionEntry(targetModule.manifest, targetVersion);
        if (!entry) return "unknown";
        const targetAbi = entry.abi || [];

        if (currentIsAbi) {
            // We're viewing one concrete ABI release: is it new enough for
            // what this module declares it needs?
            return toBadgeStatus(bestCompat(currentVersion, targetAbi));
        }

        // Neither side is a concrete ABI release here — both are declared
        // requirements from two different modules' manifests, so there is
        // no well-defined provided-vs-required direction to run the ABI's
        // rule on. Fall back to requiring an exact declared-version match.
        const overlap = targetAbi.some(v => abiHorizon.indexOf(v) !== -1);
        return overlap ? "compatible" : "mismatch";
    }

    /* ========================================================================
     * URL building
     * ====================================================================== */

    function buildModuleUrl(config, module, version, view) {
        let targetView = view || "book";
        if (module.only_mdbook) targetView = "book";
        else if (module.only_doxygen) targetView = "doxygen";

        return config.docsBaseUrl + module.repo + "/" + version + "/" + targetView + "/";
    }

    /* ========================================================================
     * SVG icon templates
     *
     * Inline SVG strings used in dynamically created menu items. Defined
     * once at module load and reused via cloneNode.
     * ====================================================================== */

    const SVG_NS = "http://www.w3.org/2000/svg";

    function makeIcon(paths) {
        const svg = document.createElementNS(SVG_NS, "svg");
        svg.setAttribute("width", "14");
        svg.setAttribute("height", "14");
        svg.setAttribute("viewBox", "0 0 24 24");
        svg.setAttribute("fill", "none");
        svg.setAttribute("stroke", "currentColor");
        svg.setAttribute("stroke-width", "2.5");
        svg.setAttribute("stroke-linecap", "round");
        svg.setAttribute("stroke-linejoin", "round");
        svg.setAttribute("aria-hidden", "true");
        for (const p of paths) {
            const el = document.createElementNS(SVG_NS, p.tag);
            for (const [k, v] of Object.entries(p.attrs)) {
                el.setAttribute(k, v);
            }
            svg.appendChild(el);
        }
        return svg;
    }

    function iconCheck() {
        return makeIcon([{ tag: "polyline", attrs: { points: "20 6 9 17 4 12" } }]);
    }

    function iconCross() {
        return makeIcon([
            { tag: "line", attrs: { x1: "18", y1: "6", x2: "6", y2: "18" } },
            { tag: "line", attrs: { x1: "6",  y1: "6", x2: "18", y2: "18" } }
        ]);
    }

    function iconDot() {
        return makeIcon([
            { tag: "circle", attrs: { cx: "12", cy: "12", r: "4", fill: "currentColor" } }
        ]);
    }

    function iconWarning() {
        return makeIcon([
            { tag: "path", attrs: { d: "M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" } },
            { tag: "line", attrs: { x1: "12", y1: "9", x2: "12", y2: "13" } },
            { tag: "line", attrs: { x1: "12", y1: "17", x2: "12.01", y2: "17" } }
        ]);
    }

    /* ========================================================================
     * Rendering: module pills
     * ====================================================================== */

    /**
     * Builds the entire modules list. Called once after manifests load.
     */
    function renderModulesList(modules, location, abiHorizon, config) {
        const container = document.querySelector("[data-liara-modules]");
        if (!container) return;
        container.innerHTML = "";

        for (const module of modules) {
            const li = renderModulePill(module, location, abiHorizon, config);
            container.appendChild(li);
        }
    }

    function renderModulePill(module, location, abiHorizon, config) {
        const li = document.createElement("li");
        li.className = "liara-navbar__module";
        li.dataset.liaraModuleKey = module.key;

        const isCurrent = location.module && location.module.key === module.key;
        if (isCurrent) li.classList.add("is-current");

        // The version label shown on the pill: the visited version if
        // we're on this module, otherwise the manifest's "latest".
        const displayVersion = isCurrent
            ? location.version
            : (module.manifest && module.manifest.metadata
            && module.manifest.metadata.latest) || "—";

        // Where does the link go? Always to the displayVersion of this
        // module. If we're on it, that's the page we're already on.
        const linkUrl = (module.manifest && module.manifest.metadata
            && module.manifest.metadata.latest)
            ? buildModuleUrl(config, module,
                module.manifest.metadata.latest, location.view)
            : "#";

        const wrap = document.createElement("div");
        wrap.className = "liara-navbar__module-wrap";

        const link = document.createElement("a");
        link.className = "liara-navbar__module-link";
        link.href = linkUrl;
        link.dataset.liaraModuleLink = "true";

        const name = document.createElement("span");
        name.className = "liara-navbar__module-name";
        name.textContent = module.name;

        const versionLabel = document.createElement("span");
        versionLabel.className = "liara-navbar__module-version";
        versionLabel.textContent = displayVersion;

        link.appendChild(name);
        link.appendChild(versionLabel);

        const trigger = document.createElement("button");
        trigger.type = "button";
        trigger.className = "liara-navbar__module-trigger";
        trigger.setAttribute("aria-haspopup", "listbox");
        trigger.setAttribute("aria-expanded", "false");
        trigger.setAttribute("aria-label", "Choose " + module.name + " version");
        trigger.dataset.liaraModuleTrigger = "true";

        const caret = document.createElementNS(SVG_NS, "svg");
        caret.setAttribute("width", "10");
        caret.setAttribute("height", "10");
        caret.setAttribute("viewBox", "0 0 10 10");
        caret.setAttribute("aria-hidden", "true");
        const caretPath = document.createElementNS(SVG_NS, "path");
        caretPath.setAttribute("d", "M2 4l3 3 3-3");
        caretPath.setAttribute("stroke", "currentColor");
        caretPath.setAttribute("stroke-width", "1.5");
        caretPath.setAttribute("fill", "none");
        caretPath.setAttribute("stroke-linecap", "round");
        caretPath.setAttribute("stroke-linejoin", "round");
        caret.appendChild(caretPath);
        trigger.appendChild(caret);

        wrap.appendChild(link);
        wrap.appendChild(trigger);
        li.appendChild(wrap);

        const menu = renderModuleDropdown(module, location, abiHorizon, config);
        li.appendChild(menu);

        wireDropdownEvents(trigger, menu);

        return li;
    }

    function renderModuleDropdown(module, location, abiHorizon, config) {
        const menu = document.createElement("ul");
        menu.className = "liara-navbar__module-menu";
        menu.setAttribute("role", "listbox");
        menu.hidden = true;
        menu.dataset.liaraModuleMenu = "true";

        const header = document.createElement("li");
        header.className = "liara-navbar__menu-header";
        header.textContent = module.name + " versions";
        menu.appendChild(header);

        // Collect versions from manifest, or fall back to a single
        // placeholder if the manifest is missing.
        let versions = [];
        if (module.manifest && module.manifest.versions) {
            versions = Object.keys(module.manifest.versions);
        } else if (location.module && location.module.key === module.key
            && location.version) {
            versions = [location.version];
        } else {
            versions = ["dev"];
        }

        // Sort: keep "dev" first, then descending semver-ish for the rest.
        versions.sort((a, b) => {
            if (a === "dev") return -1;
            if (b === "dev") return 1;
            return b.localeCompare(a, undefined, { numeric: true });
        });

        const currentModule = location.module;
        const currentVersion = location.version;

        for (const version of versions) {
            const status = evaluateCompat(module, version, abiHorizon,
                currentModule, currentVersion);
            const entry = getVersionEntry(module.manifest, version);
            const item = renderMenuItem(module, version, status, location, config,
                entry && entry.note);
            menu.appendChild(item);
        }

        return menu;
    }

    const BADGE_LABELS = {
        current:        "Current",
        compatible:     "Compatible",
        degraded:       "Degraded",
        mismatch:       "ABI mismatch",
        unknown:        "Unknown",
        meta:           "Meta",
        "meta-current": "Current"
    };

    const BADGE_TOOLTIPS = {
        current:        "You're viewing this version right now",
        compatible:     "Compatible with the current ABI",
        degraded:       "Compatible with the current ABI, but with reduced functionality (older minor or patch)",
        mismatch:       "Incompatible with the current ABI",
        unknown:        "Compatibility data not available",
        meta:           "Meta-documentation, not tied to an ABI version",
        "meta-current": "You're viewing this meta version right now"
    };

    function renderMenuItem(module, version, status, location, config, note) {
        const li = document.createElement("li");
        li.className = "liara-navbar__menu-item liara-navbar__menu-item--" + status;
        li.setAttribute("role", "option");

        const link = document.createElement("a");
        link.className = "liara-navbar__menu-link";
        link.href = buildModuleUrl(config, module, version, location.view);
        if (BADGE_TOOLTIPS[status]) {
            link.title = note ? BADGE_TOOLTIPS[status] + " — " + note : BADGE_TOOLTIPS[status];
        } else if (note) {
            link.title = note;
        }

        const statusEl = document.createElement("span");
        statusEl.className = "liara-navbar__menu-status liara-navbar__menu-status--" + status;
        if (status === "compatible") statusEl.appendChild(iconCheck());
        else if (status === "degraded") statusEl.appendChild(iconWarning());
        else if (status === "mismatch") statusEl.appendChild(iconCross());
        else if (status === "current" || status === "meta-current") statusEl.appendChild(iconDot());
        // For 'meta' and 'none', statusEl remains empty (no icon)

        // The version label, plus its optional v2 `note` underneath (e.g.
        // "LTS", "security fixes only"). v1 entries never carry a note, so
        // this wrapper renders identically to a plain version label for them.
        const versionWrap = document.createElement("span");
        versionWrap.className = "liara-navbar__menu-version-wrap";

        const versionEl = document.createElement("span");
        versionEl.className = "liara-navbar__menu-version";
        versionEl.textContent = version;
        versionWrap.appendChild(versionEl);

        if (note) {
            const noteEl = document.createElement("span");
            noteEl.className = "liara-navbar__menu-note";
            noteEl.textContent = note;
            versionWrap.appendChild(noteEl);
        }

        link.appendChild(statusEl);
        link.appendChild(versionWrap);

        if (BADGE_LABELS[status]) {
            const badge = document.createElement("span");
            badge.className = "liara-navbar__menu-badge liara-navbar__menu-badge--" + status;
            badge.textContent = BADGE_LABELS[status];
            link.appendChild(badge);
        }

        li.appendChild(link);

        return li;
    }

    /* ========================================================================
     * Dropdown wiring
     * ====================================================================== */

    function wireDropdownEvents(trigger, menu) {
        trigger.addEventListener("click", function (e) {
            e.stopPropagation();
            const isOpen = !menu.hidden;
            // Close any other open menus first
            closeAllDropdowns();
            if (!isOpen) {
                menu.hidden = false;
                trigger.setAttribute("aria-expanded", "true");
            }
        });
    }

    function closeAllDropdowns() {
        document.querySelectorAll("[data-liara-module-menu]").forEach(m => {
            m.hidden = true;
        });
        document.querySelectorAll("[data-liara-module-trigger]").forEach(t => {
            t.setAttribute("aria-expanded", "false");
        });
    }

    /* ========================================================================
     * Sub-nav (book / doxygen tabs)
     * ====================================================================== */

    function renderSubnav(location, config) {
        const subnav = document.querySelector("[data-liara-subnav]");
        if (!subnav) return;

        // Hide sub-nav if missing context OR if module restricts the view explicitly
        if (!location.module || !location.version || !location.view ||
            location.module.only_mdbook || location.module.only_doxygen) {
            subnav.hidden = true;
            return;
        }

        subnav.hidden = false;

        const moduleSlot = subnav.querySelector("[data-liara-subnav-module]");
        const versionSlot = subnav.querySelector("[data-liara-subnav-version]");
        if (moduleSlot) moduleSlot.textContent = location.module.name;
        if (versionSlot) versionSlot.textContent = location.version;

        const tabs = subnav.querySelectorAll("[data-liara-subnav-tab]");
        tabs.forEach(tab => {
            const view = tab.dataset.liaraSubnavTab;
            tab.href = buildModuleUrl(config, location.module, location.version, view);
            const isActive = view === location.view;
            tab.setAttribute("aria-selected", isActive ? "true" : "false");
        });
    }

    /* ========================================================================
     * GitHub link update
     * ====================================================================== */

    function updateGitHubLink(location) {
        const link = document.querySelector("[data-liara-github]");
        if (!link) return;
        if (location.module && location.module.repo) {
            link.href = "https://github.com/liara-engine/" + location.module.repo;
        }
    }

    /* ========================================================================
     * Mobile menu + scroll shadow (carried over)
     * ====================================================================== */

    function setupMobileMenu() {
        const toggle = document.querySelector("[data-liara-menu-toggle]");
        const navbar = document.getElementById("liara-navbar");
        if (!toggle || !navbar) return;

        toggle.addEventListener("click", function () {
            const isOpen = navbar.classList.toggle("is-open");
            toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
            toggle.setAttribute("aria-label", isOpen ? "Close menu" : "Open menu");
        });
    }

    function setupScrollShadow() {
        const navbar = document.getElementById("liara-navbar");
        if (!navbar) return;

        let ticking = false;
        function update() {
            navbar.classList.toggle("is-scrolled", window.scrollY > 0);
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

    /* ========================================================================
     * Global event handlers
     * ====================================================================== */

    function setupGlobalHandlers() {
        document.addEventListener("click", function (e) {
            // Close dropdowns when clicking outside any of them
            if (!e.target.closest("[data-liara-module-menu]")
                && !e.target.closest("[data-liara-module-trigger]")) {
                closeAllDropdowns();
            }
        });

        document.addEventListener("keydown", function (e) {
            if (e.key === "Escape") {
                closeAllDropdowns();
            }
        });
    }

    /* ========================================================================
     * FOUC prevention: apply preferences before DOMContentLoaded
     * ====================================================================== */

    applyTheme(getStoredTheme());
    applyA11yDyslexia(getStoredA11yDyslexia());

    /* ========================================================================
     * Init
     * ====================================================================== */

    async function init() {
        const config = getConfig();

        // Wire static controls
        const themeToggle = document.querySelector("[data-liara-theme-toggle]");
        if (themeToggle) themeToggle.addEventListener("click", cycleTheme);

        const a11yToggle = document.querySelector("[data-liara-a11y-toggle]");
        if (a11yToggle) {
            a11yToggle.setAttribute("aria-pressed",
                getStoredA11yDyslexia() ? "true" : "false");
            a11yToggle.addEventListener("click", toggleA11yDyslexia);
        }

        setupMobileMenu();
        setupScrollShadow();
        setupGlobalHandlers();

        // Make the brand point to the configured docs root
        const brand = document.querySelector("[data-liara-brand]");
        if (brand) brand.href = config.docsBaseUrl;

        // Fetch registry, then in parallel all manifests
        const registry = await fetchRegistry(config);
        if (!registry) {
            console.warn("liara-navbar: no registry available, module list will be empty");
            return;
        }

        const modulesWithManifests = await fetchAllManifests(registry, config);

        // Parse where we are, now that we know what counts as a "module"
        const location = parseLocation({ modules: modulesWithManifests });

        // Compute the ABI horizon from the visited page
        const abiHorizon = computeAbiHorizon(location.module, location.version);

        // Render everything
        renderModulesList(modulesWithManifests, location, abiHorizon, config);
        renderSubnav(location, config);
        updateGitHubLink(location);
    }

    function start() {
        if (document.querySelector("[data-liara-theme-toggle]")) {
            init();
        } else {
            document.addEventListener("liara-navbar-ready", init, { once: true });
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", start);
    } else {
        start();
    }
})();