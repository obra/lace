# Memory authority and permissions

`packages/agent/src/memory/authority.ts` is an internal Lace foundation for one
SQLite memory database per instance. It provides identity, current ownership and
memory permission checks. The configured
[automatic memory runtime](automatic-memory.md) uses it for background derived
notes and existing recall. Sen host enablement is separate; existing document
writers remain in charge of their files.

## Database identity and ownership

`openMemoryDatabase(path, instanceId, create = true)` creates only the
`memory_authority` table: the singleton instance ID, owner generation, root role
and configured role grants. Existing paths must already identify the same
instance before any journal, schema or permission changes. An existing empty or
unrelated database is rejected even when creation is allowed. There are no
migrations or compatibility guarantees for experimental memory databases.

Connections use WAL journaling, FULL synchronization, foreign keys and a
five-second SQLite wait. New directories use mode `0700`; database, WAL and
shared-memory files use mode `0600`. Failed opens close their connection.
Readers must pass `create = false`; a missing authority must remain unavailable.

The trusted host must acquire its existing instance runtime lock **before**
calling `claimMemoryOwner(instanceId, path, expectedRootRole, options?)`. Hosts
reopening retained authority use `{ create: false }` to prevent a missing-file
race from creating a replacement. `readMemoryInstanceId(path)` performs a
readonly, existing-file identity preflight without ownership, schema, pragma or
permission changes. The claim uses an immediate transaction to pin the root role
and rotate the owner generation. `memoryOwnerGeneration(db)` reads that
generation. Rotation fences retained bindings, including bindings used through
already-open connections. This module does not acquire a lock or establish that
a previous runtime has shut down.

## Memory permissions

The canonical `MemoryRoleGrantSchema`, `MemoryRolesSchema` and
`MemoryBindingSchema` live in `@lace/ent-protocol`. `MemoryRoles` and
`HostMemoryBinding` are inferred from those schemas. They validate structure;
they do not authenticate a caller. The host issues bindings with the current
instance, generation, role, producer, actor and root status. Model-supplied
fields cannot establish that authority.

`configureMemoryRoles(db, binding, roles)` replaces host policy in an immediate
transaction. Only the current root binding with the pinned role and matching
producer can publish it. A final access check validates the binding against the
replacement; rejection rolls back the policy update.

`assertMemoryAccess(db, binding, mutate = false)` rechecks identity, generation,
producer, read permission and the binding's note and collection grants against
current policy.
`assertMemoryCollectionAccess(db, binding, collectionId, write = false)`
additionally checks collection membership and, for writes, writable membership.
Note mutation and collection authorship are independent: a librarian may write
its configured collection while unable to mutate notes.

`resolveMemoryBinding(db, parent, role, actorId)` validates the parent and
resolves the requested role from current host policy. Child permissions are not
an intersection with the parent's permissions. Children selecting the root's
role retain its reads but lose note mutation and writable collections. An
unknown role receives producer `persona:<role>`, read permission, no note
mutation and no collections. Removing a role revokes incompatible retained
bindings; a compatible baseline read-only binding can remain valid.

## Transaction and integration boundary

The returned SQLite handle is trusted internal implementation plumbing. It is
not a public host API or protection against arbitrary SQL from in-process code.
Note and document writers must call the permission assertions on the same
connection **inside their acceptance transaction**. A successful check is not
reusable authority across a later policy replacement or owner claim.

The automatic runtime initializes its small source-reference, work, note and FTS
tables on this database under current root mutation authority. Delegates only
read existing note state. Ordinary derived notes require note mutation
permission; they do not select a writable document collection. Acceptance checks
permissions inside its immediate transaction. Session admission and prompting
enforce the persisted instance affinity and reject missing, mismatched or stale
authority. See [automatic memory](automatic-memory.md) for source coverage,
shutdown and limitations. Deliberate manual writing, correction/forget protocols
and Sen production adoption remain separate work.
