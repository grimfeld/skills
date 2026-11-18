# Handoff brief

Paste this into Claude Design when a design is settled, before marking it done. `/ship:design-me` reads the
handoff it produces, and asks about anything the handoff leaves out.

---

This design is settled. Prepare it for an agent that will build it in the app, with nobody to ask.

Publish these as files of this artifact, next to the page:

- `HANDOFF.md`: the handoff, with the sections below, in this order.
- The design's stylesheet (for example `<module>.css`): the source of every colour, radius and type choice.
- The prototype's source (for example `prototype.dc.html`): the exact behaviour and wording of every control.

The page itself stays the working reference, with every look, theme and viewport reachable from its own
controls. It must also open any view straight from its URL, for screenshots taken by a script:

- `#place=<place>&look=<look>&theme=<theme>` opens that place in that look and theme. Use the ids `HANDOFF.md`
  uses, and `dark` / `light` for themes.
- A page opened with a hash shows the view alone: no intro, tour, toast or feedback panel over it.
- The page fills the window, so the window's width is the viewport.
- List the place ids in `HANDOFF.md`'s Screens section, and the look ids in its Looks and themes section.

`HANDOFF.md` sections:

1. **Files.** A table of the files above and what each one is.
2. **Written against.** The app's commit and the code and docs the screens were checked against.
3. **What is decided.** The design's settled rules, numbered.
4. **The layout.** Desk and phone: navigation, title bar, page, controls, cards.
5. **Viewports.** Each named width the design is checked at, in pixels (for example desk 1280, phone 390).
6. **Screens.** Every place, and for each: what it holds, each part marked *existing*, *changed* or *new*,
   its dialogs, and its **states**: empty, loading, error, longest content, and any state the design adds
   (overspent, archived…). A state the design leaves as it is today says "as today".
7. **Phone rules.** Where the phone layout is stricter than today's screens.
8. **Looks and themes.** Every design token, its use, the app token it maps onto and its value in each
   combination; then the dressing per look (type, radius, borders, shadows). Write "One look, one theme" if
   there is only one.
9. **Where the design differs from the app today.** Behaviour changes, not styling, each with what it
   replaces.
10. **Yours to decide.** Every decision left to the builder or the owner, each with a recommendation.
11. **Do not copy.** What in the prototype is a stand-in: made-up data, fake behaviour, hand-made controls.
12. **Left as it is.** What is outside the design.
13. **Done when.** A checklist a reviewer can tick.

Leave out any prompt for a coding agent: the specs replace it.
