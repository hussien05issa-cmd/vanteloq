// The root URL can render either marketing or a private workspace.
// Default to private until session resolution confirms a public landing page.
let publicRoot = false;
const listeners = new Set<() => void>();
export const getPublicRoot = () => publicRoot;
export const getServerPublicRoot = () => false;
export const subscribePublicRoot = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function setPublicRoot(value: boolean) {
  if (value === publicRoot) return;
  publicRoot = value;
  listeners.forEach(listener => listener());
}
