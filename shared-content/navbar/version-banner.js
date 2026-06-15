/**
 * Liara Engine — Version / preview banner
 *
 * Shows a dismissible notice at the top of a documentation page when the page
 * is NOT the one a reader should normally trust:
 *
 *   - a PR preview   (version looks like "pr-123")         -> "preview" banner
 *   - a dev continous build (version is "dev")             -> "dev" banner
 *   - an old release (a x.y.z that is not metadata.latest) -> "old" banner
 *
 * `dev` and the current `latest` get no banner. The notice carries a random,
 * self-deprecating line (same spirit as the 404 page) and a link back to the
 * latest version of the same view.
 *
 * Self-contained: it re-parses the URL and reads window.LIARA_NAVBAR_CONFIG
 * (set by navbar.config.js). All failures are non-fatal — on any error, no
 * banner is shown. Load it deferred, AFTER navbar.config.js.
 */
(function () {
    "use strict";

    const PREVIEW_RE = /^pr-\d+$/i;
    const DEV_VERSION = "dev";
    const RELEASE_RE = /^\d+\.\d+\.\d+$/;

    const MESSAGES = {
        preview: [
            "You're on a PR preview. It might be brilliant; it might be held together with hope and a sticky comment.",
            "Preview build. This is what the docs might become, pending one nervous merge.",
            "This is a preview from an open pull request. Bugs included at no extra charge.",
            "Preview docs: freshly built, lightly tested, possibly haunted.",
            "You're looking at a proposal, not a promise. This can change or vanish without warning.",
            "PR preview ahead. If something looks off, that's arguably the point of a preview.",
            "This page exists to be reviewed, not relied on. It'll be gone when the PR closes.",
            "Ephemeral preview build. Treat every claim here as 'works on my branch'.",
            "Preview territory: here be features that may never ship.",
            "Built from an open PR. Half of this might be a different colour tomorrow.",
            "Preview only. Do not bookmark, do not cite, do not trust with production code.",
            "This is a dress rehearsal. The real show is one merge away."
        ],
        dev: [
            "You're on a dev build. It's the bleeding edge, which is exciting until it isn't.",
            "Development version. This is where the magic happens, and sometimes where it breaks.",
            "This is a dev build. It may contain features that are still finding their way.",
            "Welcome to the dev docs. They're like regular docs, but with more plot twists.",
            "Dev version ahead. It's the future, but it's also a work in progress.",
            "You're looking at the dev branch. It's where we're trying things out, not where we guarantee stability.",
            "This page is built from the latest dev code. It might be shiny, or it might be a bit rough around the edges.",
            "Dev docs: for those who like to live on the edge of what's possible (and what's broken).",
            "This is the development version. It's where we're experimenting, not where we're committing to support.",
            "You're on the dev build. It's exciting, but remember, it's also a moving target."
        ],
        old: [
            "You're reading an older version. Time has passed; some of this may have aged like milk.",
            "This is an archived version, kept for people pinned to it. For everyone else, latest is over there.",
            "Old version ahead. Accurate for its day, possibly not for yours.",
            "This page documents a past version. Unless you're stuck on it, latest is the better bet.",
            "Historical version. Preserved on purpose, but not where active development lives.",
            "You found an older release. Great for archaeology, less great for new code.",
            "This version is frozen in time. The engine has moved on; consider moving with it.",
            "Not the latest. This is here so old pins keep working, not as a recommendation.",
            "Older docs. Some of these APIs may have since been refactored into oblivion.",
            "Archived release. Reliable for its version, out of step with the current one.",
            "You're time-travelling. These docs match an earlier version of the engine.",
            "This is a previous version. If you don't specifically need it, head to latest."
        ]
    };

    function pick(arr) {
        return arr[Math.floor(Math.random() * arr.length)];
    }

    function config() {
        const c = window.LIARA_NAVBAR_CONFIG || {};
        const base = c.docsBaseUrl || (window.location.origin + "/");
        return base.charAt(base.length - 1) === "/" ? base : base + "/";
    }

    function parsePath() {
        const segs = window.location.pathname.split("/").filter(Boolean);
        if (segs.length < 2) return null;
        return { repo: segs[0], version: segs[1], view: segs[2] || "book" };
    }

    function fetchLatest(base, repo) {
        return fetch(base + repo + "/manifest.json", { cache: "no-store" })
            .then(function (res) { return res.ok ? res.json() : null; })
            .then(function (m) { return (m && m.metadata && m.metadata.latest) || null; })
            .catch(function () { return null; });
    }

    function classify(version, latest) {
        if (version === latest) return null;
        if (PREVIEW_RE.test(version)) return "preview";
        if (DEV_VERSION === version) return "dev";
        if (RELEASE_RE.test(version)) return "old";
        return null;
    }

    function render(kind, latestUrl) {
        const bar = document.createElement("div");
        bar.className = "liara-version-banner liara-version-banner--" + kind;
        bar.setAttribute("role", "status");

        const icon = document.createElement("span");
        icon.className = "liara-version-banner__icon";
        icon.setAttribute("aria-hidden", "true");
        //icon.textContent = kind === "preview" ? "\uD83E\uDDEA" : "\uD83D\uDD70\uFE0F";
        icon.textContent = kind === "preview" ? "\uD83E\uDDEA" : kind === "dev" ? "\uD83D\uDD70\uFE0F" : "\uD83D\uDCC5";

        const msg = document.createElement("span");
        msg.className = "liara-version-banner__message";
        msg.textContent = pick(MESSAGES[kind]);

        const link = document.createElement("a");
        link.className = "liara-version-banner__link";
        link.href = latestUrl;
        link.textContent = "Go to the latest version \u2192";

        const dismiss = document.createElement("button");
        dismiss.type = "button";
        dismiss.className = "liara-version-banner__dismiss";
        dismiss.setAttribute("aria-label", "Dismiss this notice");
        dismiss.textContent = "\u00D7";
        dismiss.addEventListener("click", function () { bar.remove(); });

        bar.appendChild(icon);
        bar.appendChild(msg);
        bar.appendChild(link);
        bar.appendChild(dismiss);

        const nav = document.getElementById("liara-navbar");
        if (nav && nav.parentNode) {
            nav.parentNode.insertBefore(bar, nav.nextSibling);
        } else {
            document.body.insertBefore(bar, document.body.firstChild);
        }
    }

    function run() {
        const info = parsePath();
        if (!info) return;
        const base = config();
        fetchLatest(base, info.repo).then(function (latest) {
            if (!latest) return; // not a recognizable module page
            const kind = classify(info.version, latest);
            if (!kind) return;
            render(kind, base + info.repo + "/latest/" + info.view + "/");
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", run);
    } else {
        run();
    }
})();