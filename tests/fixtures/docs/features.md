# Feature gallery

A deliberately dense page. Every construct here should render cleanly with the
shared theme.

## Headings carry the type scale

### Level three

#### Level four

The display/body/mono pairing and the heading rhythm all live in the theme.

## Inline text

Regular, **bold**, *italic*, ***bold italic***, ~~strikethrough~~, `inline code`,
and a [link to the README](./README.md) plus an
[external link](https://github.com/liara-engine/docs-shared).

## Lists

Unordered, nested:

- Rendering
    - Render packets
    - Frame graph
- Assets
    - Streaming
    - Hot reload

Ordered:

1. Parse
2. Validate
3. Emit

Task list:

- [x] Theme tokens applied
- [x] Dark mode bridged
- [ ] Your regression, hopefully not here

## Table

| Subsystem  | Status      | ABI |
|------------|-------------|----:|
| Interfaces | Stable      | dev |
| Renderer   | In progress | dev |
| Audio      | Planned     |   — |

## Blockquote

> Premature optimization is the root of all evil — but so is shipping a CSS
> regression to every module at once.

## Footnotes

The frame graph schedules passes by dependency[^fg], not by submission order[^order].

[^fg]: A directed acyclic graph of render passes.
[^order]: Submission order is only a tiebreaker.

## Horizontal rule

---

## Images

![Liara Engine logo](/shared-content/assets/logo.svg)

## Inline HTML

<kbd>Ctrl</kbd> + <kbd>K</kbd> opens search.