# @inspr/flow-shell

Reusable INSPR delivery shell: compact identity header, branch-map footer, and an explicit intent boundary for host applications.

PPM: **INSPR-384** adds opt-in fixed-height host layout, measured content reservations and scrollable delivery maps to the bounded shell. This tree prepares legacy SemVer **`0.1.4`** (`legacy-semver-public`) for **[inspr-at/flow-shell](https://github.com/inspr-at/flow-shell)**. Public **0.1.3** already has four retained, verified GitHub Release assets and remains immutable. Version **0.1.4** becomes published only when the exact approved tag passes canonical release admission and retains its four assets; source or CI success alone is not publication evidence. Failed tag **v0.1.1** and unpublished local **0.1.0** remain unchanged. `private: true` remains the npm publish guard and does not claim the `@inspr` npm namespace.

Original work is licensed under **AGPL-3.0-only**. See `LICENSE` and `NOTICES.json`. Third-party test tooling keeps its own licenses. This candidate does not relicense anything.

This package implements the approved concept direction as a **runnable shell**, not a production deployment or another disconnected design study.

## Scope

- Native `<inspr-flow-shell>` Web Component
- Pure state, gating, forecast formatting, sanitization, and intent helpers
- Optional `fromDeliveryContract()` adapter boundary for draft `inspr.delivery-stream/0.1-draft` JSON (display hints only; does not duplicate backend validation)
- Optional host-issued `inspr.flow-identity/0.1-draft` context, supplied separately. Schema validity is not authentication.
- Two standalone example hosts sharing one implementation

## Non-goals

- No execution authority, auth backend, or provider coupling
- No shared sign-in, token broker, raw OIDC subject, email join, or invented organization
- No remote dependencies (fonts, CDNs, npm runtime deps)
- Stage clicks and natural-language proposals **never execute**; hosts revalidate authority on `flow:start-intent`
- Read-only navigation may run without identity context. Consequential start/approval intents require current host-issued context and reject missing, expired, stale, mismatched, or agent-where-human-required bindings.
- Draft contract mapping distinguishes Paimos build/test, Pharos deploy/verify, and Janus prepare/apply. Completed batches derive stage and product from actual tasks; unused stages stay not-in-batch or unknown, not performed. Requesting an explicit empty, null, or unknown `batchRef` fails closed; only omitting `batchRef` may select the last batch.

## Usage

Install the runtime tarball as a host dependency (no runtime npm packages, CDN, or sibling checkout):

```html
<inspr-flow-shell>
  <section><!-- host-owned main content --></section>
</inspr-flow-shell>
<script type="module">
  import '@inspr/flow-shell';

  const shell = document.querySelector('inspr-flow-shell');
  shell.shellState = { /* normalized state */ };
  shell.addEventListener('flow-intent', (event) => {
    // host handles navigation / authorization / execution
    console.log(event.detail);
  });
</script>
```

The Web Component loads `flow-shell.css` from `import.meta.url`. The default logo is `./assets/inspr-logo.svg` next to the module; hosts may override with `logo-src` pointing at `@inspr/flow-shell/assets/inspr-logo.svg` or their own asset. In-tree examples under `examples/` still use relative `../../src/` paths for local demo serving.

### Host layout contract

Embed `<inspr-flow-shell>` in the host content column at the width you want the shell to occupy. By default (`layout-mode="viewport"`) the footer stays viewport-fixed at the bottom with full horizontal span — unchanged from 0.1.2. For sidebar or bounded columns, opt in with `layout-mode="bounded"`: the shell measures its horizontal bounds (ResizeObserver plus window resize/scroll) and applies them to viewport-fixed chrome so the footer does not sit under a sidebar while remaining visible during long-content scroll.

Optional host inputs (layout only; no identity or execution semantics):

| Input | Effect |
|-------|--------|
| `layout-mode` | `viewport` (default) or `bounded` for horizontal host-bound chrome. |
| `content-layout` | `document` (default) or `fill` for fixed-height host columns. `fill` makes the internal `.shell-root`, `.shell-scaffold`, `.shell-main`, and `.host-slot` a flex column with `min-height: 0` so slotted content can scroll inside a bounded host without min-content overflow. Pair with a host flex parent (`height`/`flex` + `overflow: hidden`) and an internal scroll region in the default slot. |
| `data-flow-host-region` (on slotted light DOM) | Optional region markers for multi-node slots: `toolbar` and `footer` stay fixed height; `body` receives the remaining column and should contain the scroll region plus any in-body project footer. A single wrapper without the attribute still works. |
| `--shell-fill-content-min` | Optional fill-layout override for the minimum host content height preserved above the delivery footer. When omitted, the shell measures shell chrome, fixed slotted toolbars/project footers, and `--shell-fill-scroll-min` (default `48px`). |
| `--shell-fill-scroll-min` | Minimum internal scroll body height to preserve in fill layout when the branch map expands (default `48px`). In fill layout the shell measures chrome above the host slot in host-local coordinates (`host-slot` viewport top minus host top), not nested `offsetTop`, then sets `--shell-footer-max-height` to the available capacity above preserved host content and `--shell-footer-space` to the measured footer height capped by that capacity. When the delivery footer cannot fit its collapsed or expanded controls in that capacity, `.shell-footer-scaffold` scrolls so collapse, review, and map content stay reachable without hiding project navigation. |
| `--shell-content-padding-inline` (CSS custom property) | Horizontal padding for header, health row, and footer. Default `48px`; compact shell widths reduce it via container queries on the internal `.shell-scaffold` descendant (not the `.shell-root` query container itself). |
| `--shell-footer-space` | Reserved bottom space so main content is not hidden under the fixed footer. Measured from the live footer height when observers run; default `183px` before first measure. The `footer-space` attribute overrides measurement until removed. Hosts that apply a global `* { padding: 0 }` reset must re-apply `padding-bottom: var(--shell-footer-space)` on `<inspr-flow-shell>` in host CSS so the reservation survives the reset and project navigation stays above the fixed delivery footer. The variable tracks live footer height, including when the branch map expands. |
| `content-padding` attribute | Sets `--shell-content-padding-inline` (for example `content-padding="20px"`). |
| `footer-space` attribute | Overrides measured `--shell-footer-space` when hosts need a fixed reserve. |

Compact header/footer rules use container queries on the internal `.shell-root` and `.shell-footer-root` wrappers (not `:host`), with responsive padding applied on `.shell-scaffold` and `.shell-footer-scaffold` descendants so a 342px content column gets compact treatment even when the viewport is wider. Viewport-fixed footer and notice chrome stay outside `.shell-root` so `container-type` layout containment cannot re-anchor fixed positioning. At narrow widths the header wraps into two rows so app identity, project title, version/instance, and account controls stay readable. Long project, instance, and version labels truncate with ellipsis; full values remain on `title` attributes, `aria-label`, and existing control labels.

`examples/host-sidebar/` is a minimal sidebar-host fixture with `layout-mode="bounded"`, a 2000px tall scroll block, and sidebar expand/collapse controls. Serve with `python3 dev-server.py 8765` and open `examples/host-sidebar/index.html`.

`examples/host-fill/` models a fixed-height classic host (`900px` column, sidebar 48/230px, global `* { padding: 0 }` reset, `content-layout="fill"`, `content-padding="0"`) with the Paimos two-node slot shape: toolbar and project body are sibling light-DOM nodes marked with `data-flow-host-region`, long content scrolls inside the body, and the project footer stays above the Flow delivery footer. `examples/host-document-scroll/` keeps the default document-scroll layout with an in-slot project footer for comparison.

Suggested Paimos consumer props (no product edits in this ticket): set `content-layout="fill"` on `<inspr-flow-shell>` inside the fixed-height `.main` column; keep `layout-mode="bounded"` and explicit `content-padding`; add host CSS `inspr-flow-shell { padding-bottom: var(--shell-footer-space); }` when a global padding reset is in effect; slot the host toolbar as `data-flow-host-region="toolbar"` and the project column as `data-flow-host-region="body"` with an internal scroll region plus project footer; give the host column `display:flex; flex-direction:column; min-height:0; overflow:hidden`.

## Examples

```sh
python3 dev-server.py 8765
# open examples/host-a/index.html, examples/host-b/index.html, examples/host-sidebar/index.html,
# examples/host-fill/index.html, and examples/host-document-scroll/index.html
```

## Tests

```sh
npm ci
npm test
```

Node 24 built-in test runner only. `happy-dom` is a locked development dependency for the committed harness; it is not a runtime dependency.

## Packaging and public release

`npm run release:build` publishes one immutable runtime coordinate under `dist/inspr-flow-shell-0.1.4/` (`inspr-flow-shell-0.1.4.tgz` + sidecar manifest) from the closed allowlist in `release/allowlist.json`. `npm run source:export` publishes `dist/inspr-flow-shell-source-0.1.4/` (`inspr-flow-shell-source-0.1.4.tgz` + sidecar manifest) with tests, release tooling, CI workflows, and curated synthetic contract fixtures. Canonical published bytes use GNU tar + Node 24 with Git committer-epoch timestamps; local BSD tar builds are valid for development and are not claimed byte-identical.

Publication inventory, coordinator gates, and the artifact contract live in `release/publication-inventory.json`. CI runs `npm test` on `main` and pull requests (`.github/workflows/ci.yml`). Release admission is manual `workflow_dispatch` with an explicit version coordinate (`.github/workflows/release.yml`). Dispatch it from `main` for an ephemeral admission run, or from tag `v0.1.4` / `0.1.4` when the checkout is exactly that tagged commit so forge retention can publish immutable GitHub Release assets. The release workflow runs `npm test`, builds runtime + source exports, proves installed runtime and extracted source consumers (`release/admit-consumer-proof.mjs`), verifies manifest/commit binding including annotated-tag peeling (`release/admit-release.mjs`), uploads ephemeral transfer artifacts, and retains forge assets only on a matching version tag. `upload-artifact` is transfer only, not publication evidence. This coordinate is not an npm registry publication; once retained release assets exist, install hosts from the GitHub Release runtime tarball, or from a Git checkout / extracted source tree until then.

From a public Git checkout or extracted non-Git source tree: `npm ci && npm test`. Tree-mode runtime rebuilds bind `release/source-provenance.json` and refuse a tampered tree or a changed existing coordinate. `private_source_commit` records opaque original lineage; `current_source_commit` is the actual public Git commit exported.

## Intent events

| Type | Executes? | Notes |
|------|-----------|-------|
| `flow:navigate-stage` | no | Stage exploration only |
| `flow:save-proposal` | no | Draft idea from host UI |
| `flow:start-intent` | no | Carries action-scoped snapshot with expiry; host must revalidate |
| `flow:review-batch` | no | Opens shell review dialog |
| `flow:toggle-map` | no | Branch map UX |
| header/health/drafts | no | Host navigation hooks |

## Forecast display

Percent and ETA always render: typed forecast values when present, otherwise a labelled conservative fallback. Raw observations stay visible and may be missing. Freshness ages from `fresh_until` against now, not only a trusted `freshness` string. A host freshness caption cannot override a computed stale observation. A 100 percent guess is never completion; an evidenced `done` observation is labelled observed done. Stages: Aithema Defines, Paimos Builds, Pharos Delivers, Janus Access. Confirmation snapshots bind scope, digest, mode, action, evidence, and opaque host identity refs, then expire against the `now` passed at use. Review-dialog mode changes sync the footer select and refresh the displayed snapshot expiry without re-rendering the dialog.

## Adapter boundary

See `src/adapter.js` for the documented mapping from draft delivery-stream contracts to shell state. Validate upstream contracts with the delivery-contracts validator; this package does not embed that validator. The adapter maps closed operations to stages (Paimos test stays on Build; Pharos owns deploy/verify; Janus owns prepare/apply), prefers in-progress/blocked work over completed prerequisites, preserves exact batch/baseline/target/artifact refs, and maps artifact provenance observation time from the claim rather than document `evaluated_at`. A development target cannot populate a pass Pharos deployment gate. Janus preparation follows the validator: preliminary, ready, or live deployment targets may prepare; apply stays ready/live plus access. Identity plus digest without producing or imported evidence stays unknown. Define/Aithema stage completion resolves the baseline catalog entry and requirements-baseline gate evidence; a dangling `baseline_ref` alone cannot render performed. Missing provenance `evidence_ref` is not substituted with artifact identity. Future observation times stay unknown even for unvalidated documents. Batches without Pharos or Janus work do not borrow a document-global deployment target.

Delivery `parties` are document claims, not runtime identity. Supply `identityContext` separately (`withIdentityContext` or `normalizeShellState({ ...mapped, identityContext })`) using a host-issued `inspr.flow-identity/0.1-draft` object. Opaque `host_id`-namespaced refs are verified by the host; display labels are untrusted; tokens, cookies, email, roles, and raw subjects are rejected. Example hosts are labelled fixtures and do not claim live identity.

Hosts that feed `shellState` directly (not via `fromDeliveryContract`) must supply `delivery.stageEvidence` for each stage (`performed`, `not_in_batch`, or `unknown`). Completion markers read only that array; stage gates still read `prerequisites`. Omitting `stageEvidence` defaults every stage to `unknown`. Pass the same injected `now` you use for freshness and confirmation expiry through stage presentation and gate evaluation.

## Non-blocking follow-ups

- Native browser proof stays with the controller. This package uses the committed happy-dom harness only.
- `getStageGate` still does not consult `evaluatedAt`; contract-sourced gates do not age; `resolveFreshness` has no max-age from `reported_at`.
- Connected shells re-age presentation on expiry boundaries and at least every ten minutes via a local clock timer and visibility return, without mutating host state or review consent.
- Conservative fallback can still print more than once on a missing-forecast line; past `estimated_finish` still clamps to `ETA ~0 min`.
- Do not duplicate the Janus Paimos dependency reporter; a future stream producer should reuse it.
- These documents and the shell remain claims and intent UI, not an auth or execution engine.
- Artifact provenance and observation fields are unsigned claims. They are not authenticated runtime attestations.
- Source-only fixture identity does not complete INSPR.2 or a real Zitadel host adapter.
