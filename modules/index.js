// Module registry: widget type → lazy import. Adding a module = a folder under modules/,
// one line here, and widget entries in config.json. See CLAUDE.md "Adding a module".
export const registry = {
  "groceries-list": () => import("./groceries/list.js"),
  "groceries-cart": () => import("./groceries/cart.js"),
  "groceries-history": () => import("./groceries/history.js"),
  "groceries-summary": () => import("./groceries/summary.js"),
  "japanese-review": () => import("./japanese/review.js"),
  "japanese-search": () => import("./japanese/search.js"),
  "japanese-stats": () => import("./japanese/stats.js"),
  "japanese-due": () => import("./japanese/due.js"),
  "media-requests": () => import("./media/requests.js"),
  "media-summary": () => import("./media/summary.js"),
  "work-items": () => import("./work/items.js"),
  "work-hours": () => import("./work/hours.js"),
};
