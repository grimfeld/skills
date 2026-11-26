// The prototype page's switcher logic, pure so node --test can reach it. build.mjs inlines this file
// into page/prototype.html at its SWITCHER placeholder, `export` keywords dropped.

// The key `delta` steps away from `current`, wrapping around both ends. From the compare view
// ("all"), forward is the first variant and back the last.
export function step(keys, current, delta) {
  let at = keys.indexOf(current);
  if (at < 0) at = delta > 0 ? -1 : keys.length;
  return keys[(((at + delta) % keys.length) + keys.length) % keys.length];
}

// The variant `?variant=` names in a location.search: a key, or "all" for the compare view.
// Missing or unknown falls back to the first key.
export function parseVariant(search, keys) {
  const asked = new URLSearchParams(search).get("variant");
  return asked === "all" || keys.includes(asked) ? asked : keys[0];
}

// `search` with ?variant= set to `key`, every other param kept, for history.replaceState.
export function withVariant(search, key) {
  const params = new URLSearchParams(search);
  params.set("variant", key);
  return `?${params}`;
}

// Whether ←/→ belong to the focused element (an event's target) rather than the switcher.
export function ignoresKeys(target) {
  return Boolean(target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable));
}

// The step a keydown asks for: +1 for →, -1 for ←, 0 for any other key, a key typed into a text
// field, or one held with a modifier (Alt+← is the browser's Back).
export function arrowDelta(event) {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || ignoresKeys(event.target)) return 0;
  return { ArrowRight: 1, ArrowLeft: -1 }[event.key] ?? 0;
}
