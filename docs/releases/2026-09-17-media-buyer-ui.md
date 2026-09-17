# Media buyer UI release

Muhammed approved production deployment of the reviewed campaign-board demo.

- Desktop sidebar now collapses to a 64px icon rail from 224px, remembers the choice, and moves content using B2B's 150ms transform animation.
- The active navigation item uses B2B's teal lamp and spring settings (stiffness 320, damping 30).
- Page navigation fades between routes. Running/off-board tabs and campaign filters transition without remounting local form controls. Reduced-motion preferences are honored.
- Campaign status uses the existing Radix Select with a centered rotating chevron, anchored menu, keyboard selection and existing ClickUp save behavior.
- The client-grouped campaign list has stronger client headings, quieter asset links, and separate campaign/stat sizing. The ambiguous phrase "client code at the end" was interpreted from the approved demo as this grouped list; no new ID field or urgency scoring was introduced.

No backend, schema, KPI, campaign execution, permissions or other cockpit changes.

Validation: production TypeScript/Vite build and full lint passed (existing warnings remain). Local browser checks confirmed 224px/64px sidebar widths, persistence on reload, keyboard dropdown selection, tab changes and unsaved input preservation. Production verification is recorded in the shared session handoff.

The checkout omitted ignored Convex generated files. Local schema-derived types were restored from the installed Convex templates for validation; no backend deployment ran. `.vercelignore` excludes environment/test files while allowing those generated frontend imports in a CLI deployment.
