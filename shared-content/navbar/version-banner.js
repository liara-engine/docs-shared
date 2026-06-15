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
 * the current `latest` get no banner. The notice carries a random,
 * self-deprecating line (same spirit as the 404 page), an info icon with a
 * clearer explanation on hover/focus/tap, and a link back to the latest version
 * of the same view.
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
            "PR preview ahead. If something looks off, that's arguably the point of a preview.",
            "Ephemeral preview build. Treat every claim here as 'works on my branch'.",
            "Preview territory: here be features that may never ship.",
            "Built from an open PR. Half of this might be a different colour tomorrow.",
            "Preview only. Do not bookmark, do not cite, do not trust with production code.",
            "This is a dress rehearsal. The real show is one merge away.",
            "This documentation exists in a quantum superposition of 'approved' and 'needs changes'.",
            "Preview environment detected. Reality may differ after merge.",
            "Built from a pull request. The code is innocent until proven production-ready.",
            "This page is a hypothesis with CI attached.",
            "Preview build: all conclusions are provisional and subject to reviewer intervention.",
            "You're looking at a possible future. Alternate timelines remain available.",
            "This content has not yet crossed the event horizon of main.",
            "Fresh from a PR. Some assembly may still be occurring.",
            "The merge button remains unpressed. Anything you see here may still be negotiated.",
            "This page was observed before release. The observation itself may have changed it.",
            "Contents generated from an unstable orbit around the main branch.",
            "Experimental snapshot. Not recommended as a citation in academic, legal, or emotional matters.",
            "This is what happens when a feature becomes visible before becoming official.",
            "This page is approaching merge velocity but has not achieved orbital insertion.",
            "The implementation and the documentation are currently racing to see which one changes first.",
            "Consider this an early access release for people who click suspicious links.",
            "This PR is currently undergoing aerodynamic stress testing. Structural failure remains an option.",
            "Preview build: the entropy of this branch is currently at an all-time high.",
            "This page is an unconverged iterative solution. Do not trust the decimals.",
            "Warning: the code behind this page is currently held together by two inline comments and sheer willpower.",
            "This page only exists because a webhook fired five minutes ago. Don't get too attached."
        ],
        dev: [
            "You're on a dev build. It's the bleeding edge, which is exciting until it isn't.",
            "Development version. This is where the magic happens, and sometimes where it breaks.",
            "Welcome to the dev docs. They're like regular docs, but with more plot twists.",
            "Dev version ahead. It's the future, but it's also a work in progress.",
            "This page is built from the latest dev code. It might be shiny, or it might be a bit rough around the edges.",
            "Dev docs: for those who like to live on the edge of what's possible (and what's broken).",
            "You're on the dev build. It's exciting, but remember, with great power comes great instability.",
            "Dev version: it's like a rollercoaster ride, thrilling but not for the faint of heart.",
            "Development version. New features ahead. Stability is following at a safe distance.",
            "Welcome to the frontier. The map is still being drawn.",
            "Dev build: where bugs are discovered before they become traditions.",
            "Current development version. Some APIs are still deciding what they want to be when they grow up.",
            "The future is being assembled here from commits and questionable assumptions.",
            "Dev build. Backward compatibility is a goal, not a law of physics.",
            "You are observing the engine before it has reached thermodynamic equilibrium.",
            "Warning: contents may contain traces of unfinished architecture.",
            "Development version. Some features are still undergoing natural selection.",
            "The code is alive and evolving. The docs are trying their best to keep pace.",
            "Dev version. If something changed since yesterday, that's not really surprising.",
            "The wavefunction of this API has not fully collapsed yet.",
            "If stable is a planet, this page is currently in low orbit.",
            "Built directly from the dev branch, where bugs go to become features.",
            "Dev branch: Where the TTL of any given feature is measured in minutes.",
            "We've injected a lot of changes into this build. Side effects may include spontaneous deprecation and mild confusion.",
            "This version is currently undergoing lithobraking against the reality of user testing.",
            "Welcome to the bleeding edge. Please wear safety goggles while reading this documentation.",
            "Dev build: Memory leaks have been scheduled for a future refactor. Watch your RAM.",
            "We skipped the unit tests for this page to optimize our CI pipeline's carbon footprint. You're welcome."
        ],
        old: [
            "This is an archived version, kept for people pinned to it. For everyone else, latest is over there.",
            "Old version ahead. Accurate for its day, possibly not for yours.",
            "This page documents a past version. Unless you're stuck on it, latest is the better bet.",
            "You found an older release. Great for archaeology, less great for new code.",
            "This version is frozen in time. The engine has moved on; consider moving with it.",
            "Older docs. Some of these APIs may have since been refactored into oblivion.",
            "Archived release. Reliable for its version, out of step with the current one.",
            "You're time-travelling. These docs match an earlier version of the engine.",
            "You're reading historical documentation. Please adjust expectations for temporal drift.",
            "This version remains available for compatibility, nostalgia, and archaeology.",
            "These docs describe the engine as it once was, not necessarily as it is.",
            "Welcome to the past. The APIs were different there.",
            "Historical snapshot. Useful when debugging old projects or old decisions, but not for new ones.",
            "This page is a museum piece. The engine has since evolved.",
            "It belongs in a museum",
            "The current engine has evolved. These docs record an earlier stage of that evolution.",
            "The information here was accurate when this version was the future.",
            "This version remains available because somebody, somewhere, still depends on it.",
            "You have successfully time-travelled. Please avoid changing the timeline.",
            "These docs were state-of-the-art before state-of-the-art moved.",
            "Current accuracy is inversely proportional to the square of the release distance.",
            "According to general relativity, every version is current in its own reference frame.",
            "This version has entered a state of maximum entropy. No further energy will be put into it.",
            "You are looking at a historical artifact. Carbon dating puts this release at approximately three breaking changes ago.",
            "Warning: This documentation has a high redshift. It is rapidly moving away from the current state of the engine.",
            "This API is deprecated. Attempting to use it in production may cause a segmentation fault in your architecture.",
            "You have crossed the event horizon of legacy support. Not even bug fixes can escape from this version.",
            "This documentation is frozen at zero Kelvin. No particles—or features—are moving here.",
            "You are reading a page from the ancient scrolls. It works, but nobody remembers why."
        ]
    };

    const EXPLAIN = {
        preview: "This page was built from an open pull request to preview proposed changes. " +
            "It is temporary, may contain errors or unfinished content, and disappears " +
            "when the request is merged or closed. For documentation you can rely on, " +
            "use the latest released version.",
        dev: "This page was built from the development branch. It may contain new features, " +
            "but also bugs, incomplete content, or breaking changes. It's useful if you want " +
            "to see the latest work in progress, but for stable documentation, use the latest release.",
        old: "This page documents an older release, kept available for anyone still pinned to " +
            "that version. It may be out of date compared with the current engine. Unless you " +
            "specifically need this version, use the latest release."
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
        icon.textContent = kind === "preview" ? "\uD83E\uDDEA" : kind === "dev" ? "\uD83D\uDD70\uFE0F" : "\uD83D\uDCC5";

        const msg = document.createElement("span");
        msg.className = "liara-version-banner__message";
        msg.textContent = pick(MESSAGES[kind]);

        const help = document.createElement("span");
        help.className = "liara-version-banner__help";

        const info = document.createElement("button");
        info.type = "button";
        info.className = "liara-version-banner__info";
        info.setAttribute("aria-label", "What does this mean?");
        info.textContent = "\u24D8";

        const tip = document.createElement("span");
        tip.className = "liara-version-banner__tooltip";
        tip.setAttribute("role", "tooltip");
        tip.textContent = EXPLAIN[kind];

        info.addEventListener("click", function (e) {
            e.preventDefault();
            help.classList.toggle("is-open");
        });

        help.appendChild(info);
        help.appendChild(tip);

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
        bar.appendChild(help);
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