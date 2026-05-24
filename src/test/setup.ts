import "@testing-library/jest-dom/vitest";

class TestResizeObserver {
  private callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  observe(target: Element) {
    this.callback([{ target, contentRect: { width: 2400, height: 1000 } } as ResizeObserverEntry], this);
  }

  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver = TestResizeObserver as typeof ResizeObserver;
window.DOMMatrixReadOnly = class {
  m22 = 1;
} as typeof DOMMatrixReadOnly;

Object.defineProperties(HTMLElement.prototype, {
  offsetHeight: { configurable: true, value: 1000 },
  offsetWidth: { configurable: true, value: 2400 }
});

HTMLElement.prototype.getBoundingClientRect = function () {
  return {
    x: 0,
    y: 0,
    width: 2400,
    height: 1000,
    top: 0,
    left: 0,
    right: 2400,
    bottom: 1000,
    toJSON: () => ({})
  };
};
