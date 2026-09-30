# Recall

Lace agents have a built-in `recall` tool: lexical search over their own past
session transcripts. It returns short previews of matching events (`search`),
expands any hit into surrounding context (`read`), and reassembles a whole
conversation thread from the current session (`thread`). It is a record of what
happened, not the current state of the world, so agents should re-check live for
facts that can change.

## Actions

`action` is required and is one of `search`, `read` or `thread`.

### `search`

Lexical (SQLite FTS5) search over indexed events. `query` is required.

Optional filters:

- `persona`: a string or array of strings
- `session_id`
- `track`
- `since`, `until`
- `limit`: default 10, maximum 100
- `order`: `relevance` (default, FTS rank) or `recent` (newest first)

Empty strings are rejected for every string input, because an empty filter would
silently match nothing.

`query` is an FTS5 match expression, not a plain string:

- Plain words are ANDed together.
- `:` selects a column, `*` marks a prefix, and `"…"` is a phrase.
- `AND`, `OR`, `NOT` and `NEAR` are operators. `NOT` excludes a term, as in
  `deploy NOT staging`. FTS5 has no leading-`-` exclusion: `deploy -staging`
  fails with `no such column: staging`.
- A term containing punctuation, such as `github-token`, is read as column
  syntax and fails. Wrap it in double quotes to search for it literally.

A syntax error returns zero hits with a hint rather than failing the turn. A
`no such column` error leads with the quoting fix. A search with no hits
suggests dropping filters or widening the date range.

### `read`

Expands one event with the events around it. `event_id` is required, in the form
`<session_id>:<seq>`.

- `context`: events on each side of the target, default 5, maximum 50
- `full`: default `false`

The target event, and every surrounding non-tool-call event (user, assistant,
notification and system), is capped at 10,000 characters. Surrounding tool-call
events are capped at 500 characters, or 10,000 when `full` is `true`. Each
result also includes the event's original journal line, redacted, best-effort —
absent when the journal row is missing, for example while an older session is
still being backfilled.

### `thread`

Reassembles a whole thread from the current session, both sides, oldest to
newest. `groupKey` is required.

Lace treats `groupKey` as opaque: the host application registers a membership
extractor that decides which events belong to which key. `thread` needs an
active session and a registered extractor; if either is missing it returns an
explicit error, never an empty result.

It keeps the newest 200 events, each capped at about 4,000 bytes. A clipped
event comes back as a truncated JSON string instead of the event object. It
reports when it has truncated, with a `read` pointer for paging the rest.

## What gets indexed

Five event types become search rows:

| Event type          | Indexed as     |
| ------------------- | -------------- |
| `prompt`            | user message   |
| `message`           | assistant text |
| `tool_use`          | tool call      |
| `context_injected`  | notification   |
| `context_compacted` | system         |

Other event types are not searchable, but `read` and `thread` still show them:
`read` reads the session transcript files and `thread` reads the verbatim event
journal, so neither is limited to the five indexed types.

## Redaction

Every `recall` output, including previews, full content and error hints, is
passed through a fixed list of token patterns: Slack (`xoxb-`, `xoxp-`,
`xoxa-`), Anthropic (`sk-ant-`), OpenAI project keys (`sk-proj-`), AWS access
keys (`AKIA`), GitHub (`ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_`), 1Password
(`ops_`) and Google API keys (`AIza`). Other OpenAI key formats, such as legacy
`sk-` and `sk-svcacct-` keys, are not matched. Search snippets also get a prefix
check. This is best-effort defense in depth, not a security boundary.
