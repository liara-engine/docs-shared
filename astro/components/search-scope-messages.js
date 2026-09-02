export const SEARCH_SCOPE_LABEL = {
    global: 'Searching dev and latest of every module.',
    preview: 'Searching this preview only.',
};

export const SEARCH_SCOPE_MESSAGES = {
    global: [
        "Older releases are not in here. They had their turn.",
        "Every module at once, which is either powerful or overwhelming depending on the query.",
        "Archived releases sat this one out. Still readable, just not findable.",
        "If it isn't current, it isn't indexed.",
        "Thirty version directories walked in. One index walked out.",
        "Cross-module search: you will find things you were not looking for.",
        "The old releases are still online. They're just not answering the door.",
        "Searching the documentation in the present tense.",
        "One index to find them all, provided they are current.",
        "Historical versions excluded, on the grounds that history does not change.",
        "Yes, this searches the other modules too. That part is deliberate.",
        "The index knows about dev and latest. Everything else is on a need-to-read basis.",
        "Rebuilt on every deploy, so it is never more than one push behind.",
        "Hunting a symbol that was removed three releases ago? Wrong window.",
        "Covers every module's current docs. Does not cover the version you pinned in 2024.",
        "The archive is intentionally quiet.",
        "Old versions are readable, linkable and completely unsearchable. Two out of three.",
        "Built over the deployed site, which is as fresh as it gets without asking the server twice.",
        "Every module's current documentation, in one box. Try a symbol name.",
        "Searching what is current. What is past is still at its old URL, waiting.",
        "This index has never heard of the version you are reading, unless it is the newest one.",
        "One index for the whole engine. It seemed cheaper than thirty.",
    ],
    preview: [
        "Just this preview. The rest of the site cannot see it, and it cannot see the rest of the site.",
        "Searching an index that will not exist next week.",
        "Only the pages in this pull request, which is rather the point.",
        "A private index for a private build. Nobody else is looking.",
        "This preview indexes itself, because nothing else has heard of it yet.",
        "Scope: one pull request. Ambition: also one pull request.",
        "The site-wide index does not know these pages exist. Yet.",
        "Freshly built, locally indexed, entirely unofficial.",
        "Searching a build that disappears when the pull request closes.",
        "Just this preview. For documentation you can cite, leave the preview.",
        "An index with a lifespan measured in review cycles.",
        "A sandbox index. It contains exactly what somebody just wrote.",
        "Nothing outside this pull request is in here.",
        "Local index, local truth, local consequences.",
        "The pages you are about to search may never ship.",
        "This index was built four minutes ago and has no plans beyond Friday.",
    ],
};

export const SEARCH_SCOPE_EXPLAIN = {
    global: 'The whole site shares one search index, rebuilt on every deploy over the '
        + 'development build and the newest release of every module. Searching from an '
        + 'older release therefore answers with the current documentation rather than '
        + 'with that release: its pages stay online and keep their URLs, but they are '
        + 'not indexed. Keeping one index instead of one per published version is what '
        + 'stops search from growing every time a release is cut.',
    preview: 'This build comes from an open pull request and is deployed nowhere else, so '
        + 'the site-wide index cannot know about it. It carries a small index of its own '
        + 'instead, covering only its own pages — which is what lets you search the '
        + 'documentation the pull request adds. It disappears with the preview.',
};

export default SEARCH_SCOPE_MESSAGES;
