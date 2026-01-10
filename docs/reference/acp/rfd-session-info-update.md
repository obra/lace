# ACP RFD: Session Info Update

Source: https://agentclientprotocol.com/rfds/session-info-update.md

## Proposal

Add a `session_info_update` variant to the existing `SessionUpdate` to allow
dynamic session identification in client UIs.

## Problems Addressed

1. **Static metadata** - Session titles cannot be updated after creation
2. **No real-time updates** - No mechanism to communicate metadata changes
3. **Protocol inconsistency** - Other dynamic properties use notifications, but
   metadata has none

## Solution

- Uses `session/update` notification method
- All fields optional for partial updates
- Contains same fields as `SessionInfo` from `session/list`

## Fields

- `title` (optional)
- `updatedAt` (optional)
- `_meta` for custom metadata

`sessionId` and `cwd` excluded (immutable/redundant).

## Use Cases

- Auto-generating titles after initial exchanges
- Dynamic title updates as context shifts
- Real-time client UI updates without polling
