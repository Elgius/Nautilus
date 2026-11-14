import assert from "node:assert/strict";
import { GlobalWindow as Window } from "happy-dom";
const dom = new Window({ url: "http://localhost:3000/room-id=test?view=docs" });
Object.assign(globalThis, { window: dom, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true, HTMLElement: dom.HTMLElement, Element: dom.Element, Node: dom.Node, getComputedStyle: dom.getComputedStyle.bind(dom), MutationObserver: dom.MutationObserver });
const { act, createElement } = await import("react");
const { createRoot } = await import("react-dom/client");
const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime");
const { ApiUnavailable } = await import("../components/auth/api-unavailable");
let refreshes = 0;
const router = {
  back() {}, forward() {}, push() { throw new Error("Must keep the current route"); },
  replace() { throw new Error("Must not redirect to login during an outage"); },
  prefetch() {}, refresh() { refreshes++; }, bfcacheId: "test",
};
const container = document.createElement("div");
document.body.append(container);
const root = createRoot(container);
try {
  await act(async () => root.render(createElement(AppRouterContext.Provider, { value: router }, createElement(ApiUnavailable))));
  assert.match(container.textContent!, /temporarily unavailable/);
  assert.match(container.querySelector('[role="status"]')!.textContent!, /Wait a moment/);
  const button = container.querySelector("button")!;
  assert.equal(button.textContent, "Try again");
  await act(async () => button.click());
  assert.equal(refreshes, 1);
  assert.equal(window.location.pathname + window.location.search, "/room-id=test?view=docs");
  // A failed refresh leaves another working retry, rather than a stuck state.
  await act(async () => button.click());
  assert.equal(refreshes, 2);
  assert.equal(button.disabled, false);
  assert.doesNotMatch(container.textContent!, /fetch failed/);
  console.log("PASS: API outage shows a retry state, retries remain usable, and the room URL is preserved.");
} finally {
  await act(async () => root.unmount());
  await dom.happyDOM.close();
}
