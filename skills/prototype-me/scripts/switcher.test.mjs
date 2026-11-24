// node --test skills/prototype-me/scripts/switcher.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { step, parseVariant, withVariant, ignoresKeys, arrowDelta } from "./switcher.mjs";

const keys = ["A", "B", "C"];

test("step moves forward and back, wrapping around both ends", () => {
  assert.equal(step(keys, "A", 1), "B");
  assert.equal(step(keys, "C", 1), "A");
  assert.equal(step(keys, "B", -1), "A");
  assert.equal(step(keys, "A", -1), "C");
});

test("step out of the compare view goes to the first variant forward, the last back", () => {
  assert.equal(step(keys, "all", 1), "A");
  assert.equal(step(keys, "all", -1), "C");
});

test("parseVariant reads ?variant=, keeps all, and falls back to the first key", () => {
  assert.equal(parseVariant("?variant=B", keys), "B");
  assert.equal(parseVariant("?theme=dark&variant=C", keys), "C");
  assert.equal(parseVariant("?variant=all", keys), "all");
  assert.equal(parseVariant("?variant=Z", keys), "A");
  assert.equal(parseVariant("?variant=", keys), "A");
  assert.equal(parseVariant("", keys), "A");
});

test("withVariant sets ?variant= and keeps the other params", () => {
  assert.equal(withVariant("", "B"), "?variant=B");
  assert.equal(withVariant("?variant=A&width=phone", "C"), "?variant=C&width=phone");
  assert.equal(withVariant("?theme=dark", "all"), "?theme=dark&variant=all");
});

test("ignoresKeys is true in an input, a textarea or contenteditable, false elsewhere", () => {
  assert.equal(ignoresKeys({ tagName: "INPUT", isContentEditable: false }), true);
  assert.equal(ignoresKeys({ tagName: "TEXTAREA", isContentEditable: false }), true);
  assert.equal(ignoresKeys({ tagName: "DIV", isContentEditable: true }), true);
  assert.equal(ignoresKeys({ tagName: "BUTTON", isContentEditable: false }), false);
  assert.equal(ignoresKeys({ tagName: "BODY", isContentEditable: false }), false);
  assert.equal(ignoresKeys(null), false);
});

test("arrowDelta maps ←/→ to a step, and nothing in a text field or with a modifier", () => {
  const body = { tagName: "BODY", isContentEditable: false };
  assert.equal(arrowDelta({ key: "ArrowRight", target: body }), 1);
  assert.equal(arrowDelta({ key: "ArrowLeft", target: body }), -1);
  assert.equal(arrowDelta({ key: "ArrowUp", target: body }), 0);
  assert.equal(arrowDelta({ key: "ArrowRight", target: { tagName: "INPUT", isContentEditable: false } }), 0);
  assert.equal(arrowDelta({ key: "ArrowLeft", altKey: true, target: body }), 0, "Alt+← is the browser's Back");
});
