import test from "node:test";
import assert from "node:assert/strict";
import { captureScrollAnchor } from "../src/scroll-anchor.ts";

function fixture() {
  const scroller = new EventTarget();
  scroller.scrollTop = 400;
  scroller.viewportTop = 40;
  scroller.getBoundingClientRect = () => ({
    top: scroller.viewportTop,
    bottom: scroller.viewportTop + 600,
  });
  const anchor = {
    isConnected: true,
    offset: 900,
    height: 32,
    closest: () => scroller,
    getBoundingClientRect() {
      const top = scroller.viewportTop + this.offset - scroller.scrollTop;
      return { top, bottom: top + this.height, height: this.height };
    },
  };
  return { scroller, anchor };
}

test("keeps a visible footer in place when status content above it grows or shrinks", () => {
  for (const change of [120, -85]) {
    const { scroller, anchor } = fixture();
    const before = anchor.getBoundingClientRect().top;
    const snapshot = captureScrollAnchor(anchor);
    anchor.offset += change;
    snapshot.restore();
    assert.equal(anchor.getBoundingClientRect().top, before);
    assert.equal(scroller.scrollTop, 400 + change);
  }
});

test("does not apply browser scroll anchoring twice or adjust for window position changes", () => {
  const { scroller, anchor } = fixture();
  const snapshot = captureScrollAnchor(anchor);
  anchor.offset += 120;
  scroller.scrollTop += 120;
  scroller.viewportTop += 20;
  snapshot.restore();
  assert.equal(scroller.scrollTop, 520);
});

test("new scroll input wins over pending layout restoration", () => {
  for (const event of ["wheel", "touchstart", "pointerdown", "keydown"]) {
    const { scroller, anchor } = fixture();
    const snapshot = captureScrollAnchor(anchor);
    scroller.dispatchEvent(new Event(event));
    scroller.scrollTop = 460;
    anchor.offset += 120;
    snapshot.restore();
    assert.equal(scroller.scrollTop, 460, event);
  }
});

test("offscreen, hidden, absent, or disconnected controls do not capture the viewport", () => {
  const { anchor } = fixture();
  assert.equal(captureScrollAnchor(null), null);
  anchor.offset = 1_100;
  assert.equal(captureScrollAnchor(anchor), null);
  anchor.offset = 350;
  assert.equal(captureScrollAnchor(anchor), null);
  anchor.offset = 900;
  anchor.height = 0;
  assert.equal(captureScrollAnchor(anchor), null);
  anchor.height = 32;
  anchor.isConnected = false;
  assert.equal(captureScrollAnchor(anchor), null);
});

test("a stale snapshot cannot affect an unmounted or reparented control", () => {
  for (const change of [
    (anchor) => {
      anchor.isConnected = false;
    },
    (anchor) => {
      anchor.closest = () => null;
    },
  ]) {
    const { scroller, anchor } = fixture();
    const snapshot = captureScrollAnchor(anchor);
    anchor.offset += 100;
    change(anchor);
    snapshot.restore();
    assert.equal(scroller.scrollTop, 400);
  }
});

test("restoration is one-shot and explicit cancellation releases it", () => {
  const { scroller, anchor } = fixture();
  const snapshot = captureScrollAnchor(anchor);
  anchor.offset += 50;
  snapshot.restore();
  anchor.offset += 50;
  snapshot.restore();
  assert.equal(scroller.scrollTop, 450);
  const canceled = captureScrollAnchor(anchor);
  canceled.cancel();
  anchor.offset += 50;
  canceled.restore();
  assert.equal(scroller.scrollTop, 450);
});
