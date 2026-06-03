# PRI-1674 Baseline Renders

These files are the deterministic outputs of rendering each bundled persona
through `TemplateEngine` using a fixed empty context. They were captured
**before** the `{{include:...}}` -> `@path` migration (PRI-1674) and are
intentionally committed as the diff target for the matching scenario test.

The scenario test at `packages/agent/src/config/pri-1674-scenario.test.ts`
re-renders every persona after the migration and asserts byte-identical output
against these files.

If you intentionally change persona content, regenerate baselines via:

```
npx tsx tests/scenarios/pri-1674-baseline/capture.ts
```
