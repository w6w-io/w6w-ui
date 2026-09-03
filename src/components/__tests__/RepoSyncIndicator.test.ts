// Run (from packages/ui): node --import ./src/test-jsx-loader.mjs --test src/components/__tests__/RepoSyncIndicator.test.ts  (Node 24)
//
// Mirrors IconButton.test.ts:1-54's JSDOM/`act` setup.
import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";

const g = globalThis as unknown as Record<string, unknown>;
const dom = new JSDOM("<!doctype html><html><body><div id=root></div></body></html>");
g.window = dom.window;
g.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", {
  value: dom.window.navigator,
  configurable: true,
});
g.HTMLElement = dom.window.HTMLElement;
g.Node = dom.window.Node;
g.matchMedia =
  dom.window.matchMedia ??
  ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
(dom.window as unknown as Record<string, unknown>).matchMedia = g.matchMedia;

class FakeMutationObserver {
  observe() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
g.MutationObserver =
  (dom.window as unknown as Record<string, unknown>).MutationObserver ?? FakeMutationObserver;
(dom.window as unknown as Record<string, unknown>).MutationObserver = g.MutationObserver;
g.IS_REACT_ACT_ENVIRONMENT = true;

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { act } = await import("react-dom/test-utils");
const { RepoSyncIndicator } = await import("../RepoSyncIndicator.tsx");

function mountRoot() {
  const container = document.getElementById("root");
  assert.ok(container);
  container.innerHTML = "";
  const root = createRoot(container);
  return { container, root };
}

function baseProps(overrides: Record<string, unknown> = {}) {
  return {
    branch: "main",
    shortSha: "abc1234",
    lastSyncLabel: "3/9/2026, 12:16:29 PM",
    onSyncNow: () => {},
    ...overrides,
  };
}

test("A3 — closed initially; trigger toggles open then closed", async () => {
  const { container, root } = mountRoot();
  await act(async () => {
    root.render(React.createElement(RepoSyncIndicator, baseProps()));
  });
  assert.equal(container.querySelector('[role="menu"]'), null);
  const trigger = container.querySelector(".w6w-repo-sync-trigger");
  assert.ok(trigger);
  assert.equal(trigger.getAttribute("aria-expanded"), "false");

  await act(async () => {
    trigger.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  assert.equal(trigger.getAttribute("aria-expanded"), "true");
  assert.ok(container.querySelector('[role="menu"]'));

  await act(async () => {
    trigger.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  assert.equal(container.querySelector('[role="menu"]'), null);

  await act(async () => {
    root.unmount();
  });
});

test("A4 — outside mousedown closes, inside mousedown does not", async () => {
  const { container, root } = mountRoot();
  await act(async () => {
    root.render(React.createElement(RepoSyncIndicator, baseProps()));
  });
  const trigger = container.querySelector(".w6w-repo-sync-trigger");
  assert.ok(trigger);
  await act(async () => {
    trigger.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  assert.ok(container.querySelector('[role="menu"]'));

  // Inside mousedown — on the menu itself — must not close.
  const menu = container.querySelector(".w6w-repo-sync-menu");
  assert.ok(menu);
  await act(async () => {
    menu.dispatchEvent(new dom.window.MouseEvent("mousedown", { bubbles: true }));
  });
  assert.ok(container.querySelector('[role="menu"]'));

  // Outside mousedown — on document.body — must close.
  await act(async () => {
    document.body.dispatchEvent(new dom.window.MouseEvent("mousedown", { bubbles: true }));
  });
  assert.equal(container.querySelector('[role="menu"]'), null);

  await act(async () => {
    root.unmount();
  });
});

test("A5 — Escape closes an open flyout", async () => {
  const { container, root } = mountRoot();
  await act(async () => {
    root.render(React.createElement(RepoSyncIndicator, baseProps()));
  });
  const trigger = container.querySelector(".w6w-repo-sync-trigger");
  assert.ok(trigger);
  await act(async () => {
    trigger.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  assert.ok(container.querySelector('[role="menu"]'));

  await act(async () => {
    document.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });
  assert.equal(container.querySelector('[role="menu"]'), null);

  await act(async () => {
    root.unmount();
  });
});

test("A6 — document listeners attach only while open, and are removed on close and on unmount", async () => {
  const { container, root } = mountRoot();
  await act(async () => {
    root.render(React.createElement(RepoSyncIndicator, baseProps()));
  });
  const trigger = container.querySelector(".w6w-repo-sync-trigger");
  assert.ok(trigger);

  const addSpy = { count: 0 };
  const removeSpy = { count: 0 };
  const origAdd = document.addEventListener.bind(document);
  const origRemove = document.removeEventListener.bind(document);
  document.addEventListener = ((...args: Parameters<typeof origAdd>) => {
    addSpy.count++;
    return origAdd(...args);
  }) as typeof document.addEventListener;
  document.removeEventListener = ((...args: Parameters<typeof origRemove>) => {
    removeSpy.count++;
    return origRemove(...args);
  }) as typeof document.removeEventListener;

  try {
    // Open → close cycle: counts must be equal afterward.
    await act(async () => {
      trigger.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    });
    assert.ok(addSpy.count > 0);
    await act(async () => {
      trigger.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    });
    assert.equal(addSpy.count, removeSpy.count);

    // Open → unmount: counts must be equal again.
    await act(async () => {
      trigger.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    });
    assert.ok(addSpy.count > removeSpy.count);
    await act(async () => {
      root.unmount();
    });
    assert.equal(addSpy.count, removeSpy.count);
  } finally {
    document.addEventListener = origAdd;
    document.removeEventListener = origRemove;
  }
});

test("A7 — onSyncNow fires once per click; syncing disables and relabels; flyout stays open", async () => {
  const { container, root } = mountRoot();
  let calls = 0;
  await act(async () => {
    root.render(React.createElement(RepoSyncIndicator, baseProps({ onSyncNow: () => calls++ })));
  });
  const trigger = container.querySelector(".w6w-repo-sync-trigger");
  assert.ok(trigger);
  await act(async () => {
    trigger.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  const syncBtn = container.querySelector('[data-testid="repo-sync-now"]');
  assert.ok(syncBtn);
  assert.equal(syncBtn.textContent, "Sync now");
  assert.equal(syncBtn.hasAttribute("disabled"), false);

  await act(async () => {
    syncBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  assert.equal(calls, 1);
  assert.ok(container.querySelector('[role="menu"]'), "flyout must stay open after Sync now");

  await act(async () => {
    root.unmount();
  });

  // Re-render with syncing=true.
  const { container: container2, root: root2 } = mountRoot();
  await act(async () => {
    root2.render(React.createElement(RepoSyncIndicator, baseProps({ syncing: true })));
  });
  const trigger2 = container2.querySelector(".w6w-repo-sync-trigger");
  assert.ok(trigger2);
  await act(async () => {
    trigger2.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  const syncBtn2 = container2.querySelector('[data-testid="repo-sync-now"]');
  assert.ok(syncBtn2);
  assert.equal(syncBtn2.textContent, "Syncing…");
  assert.equal(syncBtn2.hasAttribute("disabled"), true);

  await act(async () => {
    root2.unmount();
  });
});

test("A8 — branch always renders; shortSha/lastSyncLabel render only when non-null", async () => {
  const { container, root } = mountRoot();
  await act(async () => {
    root.render(
      React.createElement(RepoSyncIndicator, baseProps({ shortSha: null, lastSyncLabel: null })),
    );
  });
  const branchEl = container.querySelector(".w6w-repo-sync-branch");
  assert.ok(branchEl);
  assert.equal(branchEl.textContent, "main");
  assert.equal(container.querySelector(".w6w-repo-sync-sha"), null);

  const trigger = container.querySelector(".w6w-repo-sync-trigger");
  assert.ok(trigger);
  await act(async () => {
    trigger.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  const detail = container.querySelector(".w6w-repo-sync-detail");
  assert.ok(detail);
  assert.ok(!detail.textContent.includes("abc1234"));

  await act(async () => {
    root.unmount();
  });

  const { container: container2, root: root2 } = mountRoot();
  await act(async () => {
    root2.render(
      React.createElement(
        RepoSyncIndicator,
        baseProps({ shortSha: "abc1234", lastSyncLabel: "Never synced" }),
      ),
    );
  });
  const shaEl = container2.querySelector(".w6w-repo-sync-sha");
  assert.ok(shaEl);
  assert.equal(shaEl.textContent, "abc1234");
  const trigger2 = container2.querySelector(".w6w-repo-sync-trigger");
  assert.ok(trigger2);
  await act(async () => {
    trigger2.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  const detail2 = container2.querySelector(".w6w-repo-sync-detail");
  assert.ok(detail2);
  assert.ok(detail2.textContent.includes("abc1234"));
  assert.ok(detail2.textContent.includes("Never synced"));

  await act(async () => {
    root2.unmount();
  });
});

test("A1 — no w6w-repo-sync-spin element in the DOM while syncing is falsy", async () => {
  const { container, root } = mountRoot();
  await act(async () => {
    root.render(React.createElement(RepoSyncIndicator, baseProps()));
  });
  assert.equal(container.querySelector(".w6w-repo-sync-spin"), null);
  await act(async () => {
    root.unmount();
  });

  const { container: container2, root: root2 } = mountRoot();
  await act(async () => {
    root2.render(React.createElement(RepoSyncIndicator, baseProps({ syncing: false })));
  });
  assert.equal(container2.querySelector(".w6w-repo-sync-spin"), null);
  await act(async () => {
    root2.unmount();
  });
});

test("A2 — exactly one w6w-repo-sync-spin renders inside .w6w-repo-sync-icon alongside the GitHub svg while syncing", async () => {
  const { container, root } = mountRoot();
  await act(async () => {
    root.render(React.createElement(RepoSyncIndicator, baseProps({ syncing: true })));
  });
  const spins = container.querySelectorAll(".w6w-repo-sync-spin");
  assert.equal(spins.length, 1);
  const icon = container.querySelector(".w6w-repo-sync-icon");
  assert.ok(icon);
  assert.ok(icon.contains(spins[0]));
  const svgs = icon.querySelectorAll("svg");
  assert.equal(svgs.length, 2);

  await act(async () => {
    root.unmount();
  });
});

test("A3 — spin badge is aria-hidden; trigger reflects aria-busy from syncing", async () => {
  const { container, root } = mountRoot();
  await act(async () => {
    root.render(React.createElement(RepoSyncIndicator, baseProps({ syncing: true })));
  });
  const spin = container.querySelector(".w6w-repo-sync-spin");
  assert.ok(spin);
  assert.equal(spin.getAttribute("aria-hidden"), "true");
  const trigger = container.querySelector(".w6w-repo-sync-trigger");
  assert.ok(trigger);
  assert.equal(trigger.getAttribute("aria-busy"), "true");

  await act(async () => {
    root.unmount();
  });

  const { container: container2, root: root2 } = mountRoot();
  await act(async () => {
    root2.render(React.createElement(RepoSyncIndicator, baseProps({ syncing: false })));
  });
  const trigger2 = container2.querySelector(".w6w-repo-sync-trigger");
  assert.ok(trigger2);
  assert.equal(trigger2.getAttribute("aria-busy"), "false");

  await act(async () => {
    root2.unmount();
  });
});
