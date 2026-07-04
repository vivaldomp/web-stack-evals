---
slug: add-next-vue-svelte-stacks
status: complete
completed: 2026-07-04
---

# Summary

Added three benchmark stacks (next 16.2.10, vue 3.5.39, svelte 5.56.4), each a `stacks/<name>.yaml` + `stacks/<name>/template/` skeleton with Tailwind v4.3 and the scenario reference theme pre-wired; retrofitted the Angular template with the same theme block; added a stack matrix to README.md.

## Verification

- `npm ci --ignore-scripts` from committed lockfiles: OK for all three templates
- `npm run build` + `sirv` serve + HTTP 200 on :4200: OK for all three
- Angular template rebuild with theme addition: OK
- `loadStack()` schema validation on all four yamls: OK
- Repo test suite: 194/194 passed
