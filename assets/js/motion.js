/* ==========================================================================
   motion.js — entrance and ambient motion for the homepage.

   Additive only: no existing markup, stylesheet or script is touched, and
   elements are found through the classes the page already uses.

   The design is treated as fixed, which drives three decisions:

   1. Nothing in the layout flow keeps a running offset. Entrance animations
      end on the designed value and then every class and inline property this
      script added is stripped off, so a settled page is byte-for-byte what it
      was without this file.

   2. The only continuously scroll-linked effects are ones that physically
      cannot move a layout box — a background-position on the banner artwork
      and an opacity on the hero. No element is ever given a persistent
      displacement, so none can drift into its neighbour.

   3. An element is left completely untouched until it is nearly in view, and
      handed back if the reader moves away again. A hidden riser carries a
      14px `translate`, and a translate on the last element of the page would
      lengthen the scrollbar; preparing late keeps the page's scroll height at
      rest exactly what it was. Elements stacked flush against a neighbour get
      a plain fade instead, so they cannot be displaced at all.

   Honours prefers-reduced-motion, waits for the existing preloader, and only
   promotes an element to its own compositing layer while it is animating.
   ========================================================================== */
(function () {
  'use strict';

  var reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (reduceQuery.matches) return;

  var mobileQuery = window.matchMedia('(max-width: 768px)');

  /* How long each entrance runs, so cleanup can be scheduled exactly. */
  var LIFETIME = { rise: 850, fade: 900, wipe: 1000, pop: 900 };

  /* All thresholds are below the fold, which is the whole point: an element is
     only ever hidden while it is off screen, and its entrance begins just
     before it scrolls into view, so the reader never sees a blank where
     content should be — and never sees one neighbour displaced against
     another, which is what would close the gap between them. */
  var PREPARE_AHEAD = 1.5;   // hide it this many viewports below the fold
  var RELEASE_AHEAD = 2.0;   // scrolled away again: hand it back untouched
  var PLAY_AT = 1.25;        // start the entrance just before it appears
  var RESCUE_AT = 0.6;       // jumped into view while hidden: just show it

  var plan = [];         // deferred items: { el, kind, delay, top, state }
  var heroItems = [];    // the hero entrance, played when the preloader lifts
  var banner = null;     // { el, height } for the artwork drift
  var heroBand = null;   // { el, top } for the scroll fade
  var heroSettled = false;
  var armed = false;
  var pumping = false;
  var viewportH = window.innerHeight;
  var ticking = false;

  /* ---------------------------------------------------------- entrance kit */

  function item(el, kind, delay) {
    if (!el) return null;
    return { el: el, kind: kind, delay: delay || 0, top: 0, state: 'idle' };
  }

  function prepare(it) {
    if (!it || it.state !== 'idle') return;
    it.state = 'ready';
    it.el.classList.add('mo-' + it.kind);
    if (it.delay) it.el.style.setProperty('--mo-delay', it.delay + 'ms');
  }

  function play(it) {
    if (!it || it.state === 'playing' || it.state === 'done') return;
    prepare(it);
    it.state = 'playing';
    var el = it.el;
    el.classList.add('mo-busy');

    /* Two frames: the first commits the hidden state, the second flips to the
       visible one. In a single frame the browser would resolve both at once
       and skip the transition entirely. */
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        el.classList.add('mo-in');
        setTimeout(function () {
          it.state = 'done';
          settle(el);
        }, it.delay + LIFETIME[it.kind] + 150);
      });
    });
  }

  /* Return the element to a completely untouched state. */
  function settle(el) {
    el.classList.remove('mo-rise', 'mo-fade', 'mo-wipe', 'mo-pop', 'mo-in', 'mo-busy');
    el.style.removeProperty('--mo-delay');
    if (!el.getAttribute('style')) el.removeAttribute('style');
  }

  /* ------------------------------------------------------------- counters */

  /* Counts "150+" up from zero, keeping any prefix, suffix and zero padding
     ("06+" stays two digits). The element is pinned to the width it already
     had so the flex row cannot reflow while the number grows, and both the
     pin and the exact original string are restored at the end. */
  function countUp(el, duration, delay) {
    var original = el.textContent;
    var parts = original.trim().match(/^(\D*)(\d+)(\D*)$/);
    if (!parts) return;

    var prefix = parts[1];
    var suffix = parts[3];
    var target = parseInt(parts[2], 10);
    /* Pad only if the figure was written padded to begin with: "06+" counts
       through 01, 02 …, while "150+" counts 85, not 085. */
    var pad = parts[2].charAt(0) === '0' ? parts[2].length : 1;
    if (!target) return;

    /* Measured before the text changes, so the figure is pinned to the width
       the design gives it and the flex row cannot reflow as the number grows. */
    var width = el.getBoundingClientRect().width;
    if (width) el.style.minWidth = width + 'px';

    function show(value) {
      var digits = String(value);
      while (digits.length < pad) digits = '0' + digits;
      el.textContent = prefix + digits + suffix;
    }

    /* Zeroed straight away rather than when the count starts. The figure is
       still hidden behind its own entrance at this point, so the reader never
       catches the final number on screen before it counts up to it. */
    show(0);

    var start = null;
    function frame(now) {
      if (start === null) start = now;
      var t = Math.min((now - start) / duration, 1);
      show(Math.round((1 - Math.pow(1 - t, 3)) * target));
      if (t < 1) {
        requestAnimationFrame(frame);
      } else {
        el.textContent = original;
        el.style.removeProperty('min-width');
        if (!el.getAttribute('style')) el.removeAttribute('style');
      }
    }
    setTimeout(function () { requestAnimationFrame(frame); }, delay || 0);
  }

  /* ----------------------------------------------------------------- build */

  function buildHero() {
    var out = [];
    var hero = document.querySelector('.home-banner .banner-content');

    if (hero) {
      out.push(item(hero.querySelector('span'), 'rise', 0));
      out.push(item(hero.querySelector('h1'), 'rise', 90));
      out.push(item(hero.querySelector('h2'), 'rise', 180));
    }

    var stats = document.querySelectorAll('.home-banner .banner-states > div');
    for (var i = 0; i < stats.length; i++) {
      out.push(item(stats[i], 'rise', 300 + i * 80));
    }

    var bands = document.querySelectorAll('.home-banner .banner-content');
    if (bands.length > 1) out.push(item(bands[1].querySelector('p'), 'rise', 340));
    out.push(item(document.querySelector('.home-banner .tabish-img'), 'pop', 420));

    return out.filter(Boolean);
  }

  function buildSections() {
    var out = [];
    out.push(item(document.querySelector('.projects-section .section-title'), 'wipe', 0));

    var cards = document.querySelectorAll('.projects-section .project-card');
    for (var i = 0; i < cards.length; i++) {
      /* Side-by-side cards are staggered against each other; stacked ones are
         not, so a card is never mid-rise while the one above it has settled. */
      var delay = (i % 2) * 120;
      out.push(item(cards[i], 'rise', delay));
    }
    out.push(item(document.querySelector('.projects-section .project-btn'), 'rise', 120));

    out.push(item(document.querySelector('.proud-section .title'), 'wipe', 0));
    out.push(item(document.querySelector('.proud-section img[src*="what-i-create"]'), 'rise', 0));

    var created = document.querySelectorAll('.proud-section .created-item');
    for (var j = 0; j < created.length; j++) {
      out.push(item(created[j], 'fade', j * 70));
    }

    out.push(item(document.querySelector('.lets-connect-card'), 'rise', 0));
    out.push(item(document.querySelector('footer img[src*="tabish-footer"]'), 'rise', 0));

    return out.filter(Boolean);
  }

  /* ------------------------------------------------------------ scheduling */

  /* Driven per frame rather than from the scroll event. Scroll events are
     coalesced, so a fast flick, an End keypress or a restored scroll position
     can carry an element past the viewport without the handler ever seeing a
     position that would reveal it — and it would then stay invisible for good.
     Comparing cached offsets every frame has no such gap. The loop stops as
     soon as the last item is accounted for. */
  function sweep() {
    if (!armed) return true;
    var scrollY = window.pageYOffset || document.documentElement.scrollTop;
    var fold = scrollY + viewportH;
    var prepareLine = scrollY + viewportH * PREPARE_AHEAD;
    var releaseLine = scrollY + viewportH * RELEASE_AHEAD;
    var playLine = scrollY + viewportH * PLAY_AT;
    var rescueLine = scrollY + viewportH * RESCUE_AT;
    var outstanding = false;

    for (var i = 0; i < plan.length; i++) {
      var it = plan[i];
      if (it.state === 'done' || it.state === 'playing') continue;

      if (it.state === 'idle') {
        if (it.top <= fold) {
          /* Already in view — the reader opened the page here, jumped, or
             restored a scroll position. Hiding it now just to animate it back
             would flash content that is plainly visible, so it is left exactly
             as designed and never touched. */
          it.state = 'done';
          continue;
        }
        if (it.top <= prepareLine) prepare(it);
        outstanding = true;
        continue;
      }

      /* state === 'ready': hidden, and still off screen. */
      if (it.top <= rescueLine) {
        /* Carried deep into view while still hidden — a jump rather than a
           scroll. Show it immediately rather than starting an entrance the
           reader would see begin from nothing. */
        it.state = 'done';
        settle(it.el);
        continue;
      }
      if (it.top <= playLine) {
        play(it);
        continue;
      }
      if (it.top > releaseLine) {
        /* Scrolled away before it ever played. Hand the element back exactly
           as it was found, so nothing stays hidden and the page keeps its
           original scroll height. */
        it.state = 'idle';
        settle(it.el);
      }
      outstanding = true;
    }
    return !outstanding;
  }

  function pump() {
    pumping = true;
    var finished = sweep();
    if (finished) { pumping = false; return; }
    requestAnimationFrame(pump);
  }

  function startPump() {
    if (!pumping) pump();
  }

  /* ------------------------------------------------------- scroll-linked */

  function measure() {
    viewportH = window.innerHeight;
    var scrollY = window.pageYOffset || document.documentElement.scrollTop;
    if (banner) banner.height = banner.el.getBoundingClientRect().height;
    if (heroBand) heroBand.top = heroBand.el.getBoundingClientRect().top + scrollY;
    /* Offsets are refreshed for anything not yet playing. Preparing an element
       does not affect layout, so a prepared item's offset is still worth
       re-reading — images finishing their load after the first measurement
       would otherwise leave it with a stale position for good. */
    for (var i = 0; i < plan.length; i++) {
      if (plan[i].state === 'idle' || plan[i].state === 'ready') {
        plan[i].top = plan[i].el.getBoundingClientRect().top + scrollY;
      }
    }
    primeUnderPreloader();
    render();
    startPump();
  }

  /* While the preloader still covers the viewport, hiding something that is
     technically on screen costs nothing — nobody can see it. That is what lets
     the first screenful still animate in, without ever breaking the rule that
     a visible element is never hidden. */
  function primeUnderPreloader() {
    if (armed || !document.getElementById('preloader')) return;
    var limit = viewportH * PREPARE_AHEAD;
    for (var i = 0; i < plan.length; i++) {
      if (plan[i].state === 'idle' && plan[i].top <= limit) prepare(plan[i]);
    }
  }

  function render() {
    ticking = false;
    var scrollY = window.pageYOffset || document.documentElement.scrollTop;

    /* Banner artwork drifts within its own frame. The box is `cover`, so the
       frame stays filled at every offset and no edge can be exposed; and a
       background-position cannot move a layout box, so nothing can collide. */
    if (banner && !mobileQuery.matches) {
      var p = scrollY / (banner.height || viewportH);
      p = p < 0 ? 0 : (p > 1 ? 1 : p);
      if (p === 0) banner.el.style.removeProperty('background-position-y');
      else banner.el.style.backgroundPositionY = (50 + p * 45).toFixed(2) + '%';
    }

    /* Hero recedes as you scroll past it. Opacity only — no displacement. */
    if (heroBand && heroSettled) {
      var q = (scrollY - heroBand.top) / viewportH;
      q = q < 0 ? 0 : (q > 1 ? 1 : q);
      if (q === 0) {
        heroBand.el.style.removeProperty('opacity');
        if (!heroBand.el.getAttribute('style')) heroBand.el.removeAttribute('style');
      } else {
        heroBand.el.style.opacity = (1 - q * 0.75).toFixed(3);
      }
    }
  }

  function onScroll() {
    startPump();
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(render);
  }

  /* Hold the entrance until the site's own preloader lifts, so it plays for
     the visitor rather than behind the overlay. */
  function afterPreloader(done) {
    var pre = document.getElementById('preloader');
    if (!pre) { done(); return; }

    var fired = false;
    var mo = null;
    var safety = null;

    function go() {
      if (fired) return;
      fired = true;
      if (mo) mo.disconnect();
      clearTimeout(safety);
      done();
    }

    mo = new MutationObserver(function () {
      if (!document.body.contains(pre) || pre.classList.contains('hidden')) go();
    });
    mo.observe(document.body, { childList: true });
    mo.observe(pre, { attributes: true, attributeFilter: ['class'] });
    safety = setTimeout(go, 6000);
  }

  /* ------------------------------------------------------------------ run */

  function debounce(fn, wait) {
    var t;
    return function () {
      clearTimeout(t);
      t = setTimeout(fn, wait);
    };
  }

  function init() {
    document.documentElement.classList.add('motion-ready');

    heroItems = buildHero();
    plan = buildSections();

    var bannerEl = document.querySelector('.home-banner .banner-bg');
    if (bannerEl) banner = { el: bannerEl, height: 0 };

    var heroEl = document.querySelector('.home-banner .banner-content');
    if (heroEl) heroBand = { el: heroEl, top: 0 };

    /* The hero sits under the preloader, so it is safe to hide immediately. */
    heroItems.forEach(prepare);

    afterPreloader(function () {
      heroItems.forEach(play);

      /* Each figure counts in step with the entrance of its own column — the
         same 300 + 80i stagger used for the stat blocks above. */
      var stats = document.querySelectorAll('.home-banner .banner-states > div span');
      for (var i = 0; i < stats.length; i++) countUp(stats[i], 1500, 300 + i * 80);

      /* The fade only engages once the entrance has fully settled, so the two
         never write opacity to the same element at the same time. */
      setTimeout(function () { heroSettled = true; render(); }, 1700);

      armed = true;
      measure();
    });

    measure();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', debounce(measure, 150));
    window.addEventListener('orientationchange', debounce(measure, 300));
    window.addEventListener('load', measure);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);

    if (reduceQuery.addEventListener) {
      reduceQuery.addEventListener('change', function () {
        if (!reduceQuery.matches) return;
        armed = false;
        plan.concat(heroItems).forEach(function (it) {
          it.state = 'done';
          settle(it.el);
        });
        if (banner) banner.el.style.removeProperty('background-position-y');
        if (heroBand) heroBand.el.style.removeProperty('opacity');
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
