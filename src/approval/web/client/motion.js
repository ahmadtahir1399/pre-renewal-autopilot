// Prompt 8 motion layer. GSAP 3 + ScrollTrigger, self-hosted (no CDN), loaded with defer after boot.js.
// Progressive enhancement only: every page is complete without this file, and nothing here touches data,
// forms or navigation. Rules (docs/DESIGN.md section 17):
// - transform and opacity only; one ease (power3.out) and 0.3-0.8 s durations everywhere;
// - everything runs inside gsap.matchMedia('(prefers-reduced-motion: no-preference)'), so a user who asks
//   for reduced motion gets none, and switching the setting reverts every tween and ScrollTrigger at once;
// - entrances play once per page view (boot.js decides), never on a reload of the same address.
(() => {
  const root = document.documentElement;
  const release = () => root.classList.remove('motion-pending');
  const { gsap, ScrollTrigger } = window;
  if (!gsap || !ScrollTrigger) {
    release();
    return;
  }
  gsap.registerPlugin(ScrollTrigger);

  const mode = root.dataset.motion; // 'first' | 'enter' | 'still' | undefined (reduced motion, no storage)
  try {
    window.sessionStorage.setItem('pra:motion:last', location.pathname + location.search);
  } catch {
    // Storage blocked: boot.js never hid anything, so there is nothing to undo.
  }

  const EASE = 'power3.out';
  const DUR = 0.6;
  const CLEAR = 'opacity,visibility,transform';
  gsap.defaults({ ease: EASE, duration: DUR });

  const all = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));
  const inView = (el) => el.getBoundingClientRect().top < window.innerHeight * 0.92;

  /** Lists whose children arrive one after another. */
  const LIST_ITEMS = [
    '.kpis > li',
    '.rows > li',
    '.flags > li',
    '.timeline > li',
    '.recent > li',
    '.docs > li',
    '.quality__list > li',
    '.steps > li',
    '.meta > div',
    'tbody.change',
    '.facts tbody > tr',
  ].join(',');
  /** Layout wrappers: their children are the blocks that move, not the wrapper itself. */
  const WRAPPERS = '.pack, .job, .upload-grid, .pack__body, .job__body, .job__side';
  /** Numbers that count up on first view: the KPI values and the analysis quality figures. */
  const COUNTERS = '.kpi__value, .q__num';

  function blocksOf(parent) {
    const out = [];
    for (const el of parent.children) {
      if (el.matches(WRAPPERS)) out.push(...blocksOf(el));
      else out.push(el);
    }
    return out;
  }

  /** Count the leading number of `el` up from 0. Returns a function that restores the real value. */
  function countUp(el, delay) {
    const node = el.firstChild;
    if (!node || node.nodeType !== Node.TEXT_NODE) return () => {};
    const text = node.nodeValue ?? '';
    const end = Number(text.trim());
    if (!Number.isInteger(end) || end <= 0 || end > 99999) return () => {};
    const counter = { value: 0 };
    node.nodeValue = '0';
    const tween = gsap.to(counter, {
      value: end,
      delay,
      duration: Math.min(0.8, 0.4 + end * 0.04),
      ease: 'power2.out',
      onUpdate: () => {
        node.nodeValue = String(Math.round(counter.value));
      },
      onComplete: () => {
        node.nodeValue = text;
      },
    });
    return () => {
      tween.kill();
      node.nodeValue = text;
    };
  }

  /** The page-load entrance, the scroll reveals below the fold and the count-ups. */
  function entrance(main, cleanups) {
    const blocks = blocksOf(main);
    const items = all(LIST_ITEMS, main);
    const nowBlocks = blocks.filter(inView);
    const laterBlocks = blocks.filter((el) => !inView(el));
    const nowItems = items.filter(inView);
    const laterItems = items.filter((el) => !inView(el));

    const tl = gsap.timeline();
    if (mode === 'first') {
      const side = all('.sidebar .logo, .sidebar .nav li, .sidebar__foot > *');
      if (side.length) tl.from(side, { autoAlpha: 0, x: -8, duration: 0.5, stagger: 0.05, clearProps: CLEAR }, 0);
      tl.from(all('.mode-bar, .app-header'), { autoAlpha: 0, y: -8, duration: 0.45, stagger: 0.05, clearProps: CLEAR }, 0.05);
    }
    if (nowBlocks.length) tl.from(nowBlocks, { autoAlpha: 0, y: 18, stagger: 0.07, clearProps: CLEAR }, mode === 'first' ? 0.15 : 0);
    if (nowItems.length) {
      tl.from(nowItems, { autoAlpha: 0, y: 10, duration: 0.45, stagger: { amount: Math.min(0.5, nowItems.length * 0.04) }, clearProps: CLEAR }, '<0.12');
    }
    const icons = all('.banner__icon, .step--done .step__glyph, .step--current .step__glyph', main).filter(inView);
    // The risk units fill in one after another, worst first, as the queue's risk builds up.
    const units = all('.units > .unit', main);
    if (units.length) tl.from(units, { autoAlpha: 0, scale: 0.4, duration: 0.35, ease: 'back.out(2)', stagger: { amount: Math.min(0.6, units.length * 0.03) }, clearProps: CLEAR }, 0.2);
    if (icons.length) tl.from(icons, { scale: 0.5, autoAlpha: 0, duration: 0.5, ease: 'back.out(2.2)', stagger: 0.06, clearProps: CLEAR }, '<0.1');

    if (laterBlocks.length) gsap.set(laterBlocks, { autoAlpha: 0, y: 24 });
    if (laterItems.length) gsap.set(laterItems, { autoAlpha: 0, y: 12 });
    if (laterBlocks.length) ScrollTrigger.batch(laterBlocks, {
      start: 'top 92%',
      once: true,
      onEnter: (batch) => gsap.to(batch, { autoAlpha: 1, y: 0, stagger: 0.08, overwrite: true, clearProps: CLEAR }),
    });
    if (laterItems.length) ScrollTrigger.batch(laterItems, {
      start: 'top 95%',
      once: true,
      onEnter: (batch) => gsap.to(batch, { autoAlpha: 1, y: 0, duration: 0.45, stagger: 0.04, overwrite: true, clearProps: CLEAR }),
    });

    const restores = [];
    const restoreCounters = () => {
      for (const restore of restores.splice(0)) restore();
    };
    cleanups.push(restoreCounters);
    for (const el of all(COUNTERS, main)) {
      if (inView(el)) {
        restores.push(countUp(el, 0.25));
        continue;
      }
      let restore = null;
      const node = el.firstChild;
      const text = node?.nodeValue ?? null;
      if (node && text !== null && /^\s*\d+\s*$/.test(text)) node.nodeValue = '0';
      ScrollTrigger.create({
        trigger: el,
        start: 'top 95%',
        once: true,
        onEnter: () => {
          if (node && text !== null) node.nodeValue = text;
          restore = countUp(el, 0.1);
        },
      });
      restores.push(() => {
        if (restore) restore();
        else if (node && text !== null) node.nodeValue = text;
      });
    }

    // Printing (or saving as PDF) before scrolling down must not leave anything invisible or half-counted.
    const showAll = () => {
      const later = [...laterBlocks, ...laterItems];
      if (later.length) gsap.set(later, { clearProps: CLEAR });
      restoreCounters();
    };
    window.addEventListener('beforeprint', showAll);
    cleanups.push(() => window.removeEventListener('beforeprint', showAll));
  }

  /** One highlight that slides behind the sidebar links: to the hovered or focused link, then back. */
  function indicator(cleanups) {
    const nav = document.querySelector('.sidebar .nav');
    if (!nav) return;
    const links = all('.nav__item', nav);
    if (!links.length) return;
    const current = nav.querySelector('.nav__item.is-current');
    const pill = document.createElement('span');
    pill.className = 'nav__indicator';
    pill.setAttribute('aria-hidden', 'true');
    nav.prepend(pill);
    nav.classList.add('has-indicator');
    gsap.set(pill, { autoAlpha: 0, transformOrigin: '0% 50%' });

    let shownWidth = 0;
    const place = (link, animate) => {
      if (!link) {
        gsap.to(pill, { autoAlpha: 0, duration: 0.25, overwrite: 'auto' });
        shownWidth = 0;
        return;
      }
      // Layout offsets, not getBoundingClientRect: they ignore transforms, so a link that is still sliding in
      // during the entrance cannot shift the pill (each link's offsetParent is its <li>, whose parent is .nav).
      const item = link.parentElement;
      const x = (item?.offsetLeft ?? 0) + link.offsetLeft;
      const y = (item?.offsetTop ?? 0) + link.offsetTop;
      const r = { width: link.offsetWidth, height: link.offsetHeight };
      gsap.set(pill, { width: r.width, height: r.height });
      if (!animate || shownWidth === 0) {
        gsap.set(pill, { x, y, scaleX: 1 });
        gsap.to(pill, { autoAlpha: 1, duration: animate ? 0.25 : 0, overwrite: 'auto' });
      } else {
        gsap.fromTo(pill, { scaleX: shownWidth / r.width }, { x, y, scaleX: 1, autoAlpha: 1, duration: 0.4, overwrite: 'auto' });
      }
      shownWidth = r.width;
    };
    place(current, false);

    const listeners = [];
    const on = (target, type, fn) => {
      target.addEventListener(type, fn);
      listeners.push(() => target.removeEventListener(type, fn));
    };
    for (const link of links) {
      on(link, 'pointerenter', () => place(link, true));
      on(link, 'focus', () => place(link, true));
    }
    on(nav, 'pointerleave', () => place(current, true));
    on(nav, 'focusout', (event) => {
      if (!nav.contains(event.relatedTarget)) place(current, true);
    });
    let resizeTimer = 0;
    on(window, 'resize', () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => place(current, false), 120);
    });

    cleanups.push(() => {
      for (const off of listeners) off();
      window.clearTimeout(resizeTimer);
      pill.remove();
      nav.classList.remove('has-indicator');
    });
  }

  /** Disclosures (technical details, full quotes): the revealed content settles in. */
  function disclosures(cleanups) {
    for (const details of all('details')) {
      const onToggle = () => {
        if (!details.open) return;
        const body = Array.from(details.children).filter((child) => child.tagName !== 'SUMMARY');
        gsap.from(body, { autoAlpha: 0, y: -6, duration: 0.35, clearProps: CLEAR });
      };
      details.addEventListener('toggle', onToggle);
      cleanups.push(() => details.removeEventListener('toggle', onToggle));
    }
  }

  const mm = gsap.matchMedia();
  mm.add('(prefers-reduced-motion: no-preference)', () => {
    const cleanups = [];
    const main = document.querySelector('.main');
    if (main && (mode === 'first' || mode === 'enter')) entrance(main, cleanups);
    indicator(cleanups);
    disclosures(cleanups);
    document.fonts?.ready.then(() => ScrollTrigger.refresh());
    return () => {
      for (const done of cleanups.splice(0)) done();
    };
  });
  // The tweens above have already applied their start states, so the regions can be shown in this same frame.
  release();
})();
