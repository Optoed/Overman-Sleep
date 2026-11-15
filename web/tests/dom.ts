import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost:3000' });
for (const key of ['window','document','navigator','HTMLElement','HTMLInputElement','HTMLButtonElement','Element','Node','NodeFilter','Event','CustomEvent','MutationObserver','getComputedStyle'] as const) {
  Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true, writable: true });
}
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true, writable: true });
Object.defineProperty(globalThis, 'ResizeObserver', { value: class { observe() {} unobserve() {} disconnect() {} }, configurable: true });
