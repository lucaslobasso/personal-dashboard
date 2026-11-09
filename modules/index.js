// Module registry: widget type → lazy import. Adding a module = a folder under modules/,
// one line here, and widget entries in config.json. See CLAUDE.md "Adding a module".
export const registry = {
  "groceries-list": () => import("./groceries/list.js"),
  "groceries-cart": () => import("./groceries/cart.js"),
  "groceries-history": () => import("./groceries/history.js"),
  "japanese-search": () => import("./japanese/search.js"),
  "japanese-stats": () => import("./japanese/stats.js"),
};
