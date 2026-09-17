import assert from "node:assert/strict";
import test from "node:test";
import { RecentNotes } from "../src/recent-notes.ts";
import { Keymap } from "../src/theme.ts";

function history() {
  const recent = new RecentNotes();
  for (const id of ["a", "b", "c"]) recent.opened(id);
  return recent;
}

function switchNote(recent, current, time, available = ["a", "b", "c"]) {
  const next = recent.next(current, available, time);
  if (next) recent.opened(next, true);
  return next;
}

test("presses two seconds apart toggle the last two opened notes", () => {
  const recent = history();
  // File listing order does not determine opening order.
  assert.equal(switchNote(recent, "c", 0), "b");
  assert.equal(switchNote(recent, "b", 2000), "c");
  assert.equal(switchNote(recent, "c", 4000), "b");
});

test("rapid presses traverse a stable history, wrap, and commit the last selection", () => {
  const recent = history();
  assert.equal(switchNote(recent, "c", 0), "b");
  assert.equal(switchNote(recent, "b", 200), "a");
  assert.equal(switchNote(recent, "a", 400), "c");
  assert.equal(switchNote(recent, "c", 1400), "a");
});

test("opening a note normally starts a new cycle", () => {
  const recent = history();
  switchNote(recent, "c", 0);
  recent.opened("a");
  assert.equal(switchNote(recent, "a", 100), "b");
});

test("renames preserve opening order and an active cycle", () => {
  const recent = history();
  switchNote(recent, "c", 0);
  recent.rename("b", "renamed");
  recent.rename("b", "renamed"); // Backend event and save response may both report it.
  assert.equal(switchNote(recent, "renamed", 200, ["a", "renamed", "c"]), "a");
  assert.equal(switchNote(recent, "a", 2200, ["a", "renamed", "c"]), "renamed");
});

test("deleted notes are skipped and unopened files are not added", () => {
  const recent = history();
  assert.equal(switchNote(recent, "c", 0, ["a", "c", "unopened"]), "a");
  assert.equal(switchNote(recent, "a", 200, ["a", "unopened"]), undefined);
  assert.equal(switchNote(recent, "a", 400, []), undefined);
});

test("empty history is harmless and a draft returns to the last opened note", () => {
  assert.equal(new RecentNotes().next(null, [], 0), undefined);
  const recent = history();
  recent.opened(null);
  assert.equal(switchNote(recent, null, 0), "c");
});

test("cycle shortcut supports config overrides", () => {
  const defaults = { cycle_recent: ["Ctrl+Tab"] };
  const tab = { key: "Tab", ctrlKey: true, metaKey: false, shiftKey: false, altKey: false };
  assert.equal(new Keymap(defaults).is(tab, "cycle_recent"), true);
  const custom = new Keymap(defaults, { cycle_recent: ["Alt+R"] });
  assert.equal(custom.is(tab, "cycle_recent"), false);
  assert.equal(custom.is({ ...tab, key: "r", ctrlKey: false, altKey: true }, "cycle_recent"), true);
});
