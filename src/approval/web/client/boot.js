// Prompt 8 motion boot. Loaded in <head> WITHOUT defer, so it runs before the first paint. It only decides
// whether this page view gets an entrance animation; motion.js (deferred, with GSAP) does the animating.
// It never hides anything under prefers-reduced-motion, on a reload of the same address (the analysis page
// refreshes itself every 2 seconds while it runs), or when storage is blocked. The stylesheet's failsafe shows
// the page after 1.5 s if the deferred scripts never run.
(() => {
  const root = document.documentElement;
  const KEY = 'pra:motion:last';
  let reduce = true;
  try {
    reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    reduce = true;
  }
  if (reduce) return;
  const here = location.pathname + location.search;
  let last = null;
  try {
    last = window.sessionStorage.getItem(KEY);
  } catch {
    return;
  }
  if (last === here) {
    root.dataset.motion = 'still';
    return;
  }
  // 'first': the first page of this tab's visit (full entrance, sidebar included); 'enter': a later page.
  root.dataset.motion = last === null ? 'first' : 'enter';
  root.classList.add('motion-pending');
})();
