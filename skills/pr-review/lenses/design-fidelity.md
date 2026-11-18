---
lens: design-fidelity
source: local
---

# Lens: design fidelity

Your lane: **does the built UI match the design handoff the spec names**, in every look, theme and viewport.
Code quality, general accessibility and performance belong to other lenses; mark any you report `"lane": "out"`.
The reference uses made-up data and the app its own, so judge structure and dressing, never the data.

Set `"evidence_type": "measured"` for findings from the capture report and `"source"` for those from reading code.

## 1. Read the design

From the spec's Design section: the handoff folder, the places this spec implements, and the viewports. Read
`HANDOFF.md` for those places: what each holds and in what order, its states, the phone rules, the token and
dressing tables, and "Do not copy".

## 2. Capture

Run, from the repository root you were given:

```
node <skill dir>/scripts/design-capture.mjs --manifest docs/design/<module>/fidelity.json \
  --out <fidelity out> --places <this spec's places> [--app-url <audit URL>]
```

Pass `--app-url` only when you were given an audit URL. The manifest's format is in
`<skill dir>/references/fidelity-manifest.md`.

- A missing manifest, or a place this spec implements with no `app` path in it, is a `major` finding: the spec's
  views can't be checked. Go on from source.
- A capture that fails (the app doesn't start, Playwright is missing) is not a finding about the change: name it
  in the coverage line and go on from source.

## 3. Mechanical checks

From `<fidelity out>/report.json`:

- **Contrast:** every entry under `contrast` is a finding. Set it `major` on text a person must read, and `minor` on
  decoration. Name the look, theme and viewport.
- **Tokens:** every `ok: false` is a `major` finding. Name the token, the combination, and the value found
  against the value expected.

## 4. Visual comparison

For each place, look at the reference and app screenshots side by side (`<look>-<theme>-<viewport>.reference.png`
and `.app.png`), every combination. Check:

- **Structure:** the same parts, in the same order, with the same controls and labels. A part missing or added is
  a `blocker` when the handoff marks it new or changed, and `major` otherwise.
- **Looks change visuals only:** the app shows the same parts in the same order in every look. Any difference in
  content between looks is a `blocker`: the handoff forbids it.
- **Phone rules:** each rule the handoff lists for the phone (bars in one row, tabs at a fixed size, floating
  buttons, bottom sheets, tap target sizes) holds at the phone viewport.
- **Dressing:** type, radius, borders, shadows and spacing per look, against the handoff's dressing table.
  Clear mismatches are `minor`; small spacing drift is a `nit`.
- **States:** each state the handoff lists for the place (empty, overspent, long content…) that the capture
  doesn't show: check it in the code, and say what you checked from source.
- **Do not copy:** prototype data, class names or hand-made controls in the diff where the kit has one: `major`.

Use `"file"` for the component that renders the part when you can find it, otherwise `"(change)"`. Put the
screenshot paths in `evidence`.

## Severity

As the finding format says, plus the cases above. A view that matches gets no finding.

Done when every place this spec implements has been compared in every look × theme × viewport, and every
mechanical failure in the report is a finding.
