/* ==========================================================================
   case-study.js — scroll behaviour for the case study page.

   Additive only; it drives elements by the classes the page already carries.

   Built on the same rules as the rest of the site's motion:
     - nothing is hidden while it is on screen, so the reader never meets a
       blank where content should be;
     - entrances resolve to the designed value and then the script strips off
       every class and inline property it added;
     - the scheduler runs per frame rather than from the scroll event, because
       scroll events are coalesced and a fast flick could otherwise carry an
       element past the viewport while it is still hidden;
     - prefers-reduced-motion returns before anything is touched.
   ========================================================================== */
(function () {
  'use strict';

  var reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (reduceQuery.matches) return;

  var root = document.documentElement;
  var LIFETIME = { rise: 800, fade: 900, wipe: 950 };
  var PREPARE_AHEAD = 1.5;
  var RELEASE_AHEAD = 2.0;
  var PLAY_AT = 1.25;
  var RESCUE_AT = 0.6;

  var plan = [];
  var counters = [];
  var statements = [];
  var pinGroups = [];
  var trackGroups = [];
  var rail = null;
  var progressBar = null;
  var viewportH = window.innerHeight;
  var docScrollable = 1;
  var running = false;
  var budget = 0;

  /* ------------------------------------------------------------ entrances */

  function item(el, kind, delay) {
    return el ? { el: el, kind: kind, delay: delay || 0, top: 0, state: 'idle' } : null;
  }

  function prepare(it) {
    if (it.state !== 'idle') return;
    it.state = 'ready';
    it.el.classList.add('cs-' + it.kind);
    if (it.delay) it.el.style.setProperty('--cs-delay', it.delay + 'ms');
  }

  function play(it) {
    if (it.state === 'playing' || it.state === 'done') return;
    prepare(it);
    it.state = 'playing';
    var el = it.el;
    el.classList.add('cs-busy');
    /* Two frames: the first commits the hidden state, the second flips it, so
       the browser cannot collapse both into one style resolution. */
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        el.classList.add('cs-in');
        setTimeout(function () {
          it.state = 'done';
          settle(el);
        }, it.delay + LIFETIME[it.kind] + 150);
      });
    });
  }

  function settle(el) {
    el.classList.remove('cs-rise', 'cs-fade', 'cs-wipe', 'cs-in', 'cs-busy');
    el.style.removeProperty('--cs-delay');
    if (!el.getAttribute('style')) el.removeAttribute('style');
  }

  function sweepEntrances(scrollY) {
    var fold = scrollY + viewportH;
    var prepareLine = scrollY + viewportH * PREPARE_AHEAD;
    var releaseLine = scrollY + viewportH * RELEASE_AHEAD;
    var playLine = scrollY + viewportH * PLAY_AT;
    var rescueLine = scrollY + viewportH * RESCUE_AT;

    for (var i = 0; i < plan.length; i++) {
      var it = plan[i];
      if (it.state === 'done' || it.state === 'playing') continue;

      if (it.state === 'idle') {
        if (it.top <= fold) { it.state = 'done'; continue; }
        if (it.top <= prepareLine) prepare(it);
        continue;
      }
      if (it.top <= rescueLine) { it.state = 'done'; settle(it.el); continue; }
      if (it.top <= playLine) { play(it); continue; }
      if (it.top > releaseLine) { it.state = 'idle'; settle(it.el); }
    }
  }

  /* ------------------------------------------------------------- counters */

  /* The final figure lives in the markup, so a reader with reduced motion — or
     with scripting off — sees the real number rather than a zero. It is only
     wound back to zero here, and only while it is still below the fold, so the
     count is never seen jumping backwards from its final value. */
  function initCounter(el) {
    var target = parseInt(el.getAttribute('data-count'), 10);
    if (isNaN(target)) return null;

    var scrollY = window.pageYOffset || root.scrollTop;
    var top = el.getBoundingClientRect().top + scrollY;
    var c = { el: el, target: target, top: top, done: false };

    if (top <= scrollY + viewportH) {
      /* Already on screen at load: leave the number exactly as written. */
      c.done = true;
    } else {
      el.textContent = '0';
    }
    return c;
  }

  function runCounter(c) {
    if (c.done) return;
    c.done = true;
    var start = null;
    var dur = 1400;
    function frame(now) {
      if (start === null) start = now;
      var t = Math.min((now - start) / dur, 1);
      c.el.textContent = Math.round((1 - Math.pow(1 - t, 3)) * c.target);
      if (t < 1) requestAnimationFrame(frame);
      else c.el.textContent = String(c.target);
    }
    requestAnimationFrame(frame);
  }

  /* ------------------------------------------------- statement word light */

  function updateStatement(s, scrollY) {
    var span = s.height + viewportH * 0.55;
    var p = (scrollY + viewportH * 0.82 - s.top) / span;
    p = p < 0 ? 0 : (p > 1 ? 1 : p);
    var lit = Math.round(p * s.words.length);
    if (lit === s.lit) return;
    s.lit = lit;
    for (var i = 0; i < s.words.length; i++) {
      s.words[i].classList.toggle('is-lit', i < lit);
    }
  }

  /* ------------------------------------------ active row in pinned lists */

  function updateActive(group, scrollY) {
    var centre = scrollY + viewportH * 0.45;
    var best = -1, bestDist = Infinity;
    for (var i = 0; i < group.rows.length; i++) {
      var r = group.rows[i];
      var mid = r.top + r.height / 2;
      var d = Math.abs(mid - centre);
      if (d < bestDist) { bestDist = d; best = i; }
    }
    if (best === group.active) return;
    group.active = best;
    for (var j = 0; j < group.rows.length; j++) {
      group.rows[j].el.classList.toggle('is-active', j === best);
    }
  }

  /* ------------------------------------------------------- horizontal rail */

  function layoutRail() {
    if (!rail) return;
    var wide = window.innerWidth >= 992;
    var travel = rail.track.scrollWidth - rail.viewport.clientWidth;

    if (!wide || travel <= 0) {
      /* Fall back to a normal horizontally scrollable strip. */
      rail.active = false;
      rail.section.style.removeProperty('height');
      rail.track.style.removeProperty('transform');
      rail.viewport.style.overflowX = 'auto';
      return;
    }
    rail.active = true;
    rail.travel = travel;
    rail.viewport.style.overflowX = 'hidden';
    /* Enough scroll length to walk the track past the viewport once. */
    rail.section.style.height = (viewportH + travel) + 'px';
    rail.top = rail.section.getBoundingClientRect().top + (window.pageYOffset || root.scrollTop);
  }

  function updateRail(scrollY) {
    if (!rail || !rail.active) return;
    var p = (scrollY - rail.top) / (rail.section.offsetHeight - viewportH);
    p = p < 0 ? 0 : (p > 1 ? 1 : p);
    rail.track.style.transform = 'translate3d(' + (-p * rail.travel).toFixed(1) + 'px,0,0)';
  }

  /* ---------------------------------------------------------------- frame */

  function measure() {
    viewportH = window.innerHeight;
    var scrollY = window.pageYOffset || root.scrollTop;
    docScrollable = Math.max(1, document.body.scrollHeight - viewportH);

    layoutRail();

    for (var i = 0; i < plan.length; i++) {
      if (plan[i].state === 'idle' || plan[i].state === 'ready') {
        plan[i].top = plan[i].el.getBoundingClientRect().top + scrollY;
      }
    }
    for (var c = 0; c < counters.length; c++) {
      counters[c].top = counters[c].el.getBoundingClientRect().top + scrollY;
    }
    for (var s = 0; s < statements.length; s++) {
      var r = statements[s].el.getBoundingClientRect();
      statements[s].top = r.top + scrollY;
      statements[s].height = r.height;
    }
    var groups = pinGroups.concat(trackGroups);
    for (var g = 0; g < groups.length; g++) {
      for (var k = 0; k < groups[g].rows.length; k++) {
        var rr = groups[g].rows[k].el.getBoundingClientRect();
        groups[g].rows[k].top = rr.top + scrollY;
        groups[g].rows[k].height = rr.height;
      }
    }
    wake();
  }

  function frame() {
    var scrollY = window.pageYOffset || root.scrollTop;

    sweepEntrances(scrollY);
    updateRail(scrollY);

    if (progressBar) {
      var p = scrollY / docScrollable;
      progressBar.style.transform = 'scaleX(' + (p < 0 ? 0 : p > 1 ? 1 : p).toFixed(4) + ')';
      progressBar.style.width = '100%';
    }

    for (var c = 0; c < counters.length; c++) {
      if (!counters[c].done && counters[c].top <= scrollY + viewportH * 0.9) runCounter(counters[c]);
    }
    for (var s = 0; s < statements.length; s++) updateStatement(statements[s], scrollY);
    for (var i = 0; i < pinGroups.length; i++) updateActive(pinGroups[i], scrollY);
    for (var t = 0; t < trackGroups.length; t++) updateActive(trackGroups[t], scrollY);

    /* Demand-driven rather than a permanent loop: scrolling tops the budget
       back up, and a still page stops asking for frames altogether. */
    if (budget > 0) {
      budget--;
      requestAnimationFrame(frame);
    } else {
      running = false;
    }
  }

  function wake() {
    budget = 90;
    if (!running) {
      running = true;
      requestAnimationFrame(frame);
    }
  }

  /* ------------------------------------------------------------------ run */

  function collectGroup(listSel, rowSel) {
    var out = [];
    document.querySelectorAll(listSel).forEach(function (list) {
      var rows = [];
      list.querySelectorAll(rowSel).forEach(function (el) {
        rows.push({ el: el, top: 0, height: 0 });
      });
      if (rows.length) out.push({ rows: rows, active: -1 });
    });
    return out;
  }

  function debounce(fn, wait) {
    var t;
    return function () { clearTimeout(t); t = setTimeout(fn, wait); };
  }

  function init() {
    root.classList.add('cs-motion');

    /* Entrance targets, declared in the markup via data-cs. */
    document.querySelectorAll('[data-cs]').forEach(function (el) {
      var kind = el.getAttribute('data-cs');
      if (!LIFETIME[kind]) return;
      var it = item(el, kind, parseInt(el.getAttribute('data-cs-delay'), 10) || 0);
      if (it) plan.push(it);
    });

    document.querySelectorAll('[data-count]').forEach(function (el) {
      var c = initCounter(el);
      if (c) counters.push(c);
    });

    document.querySelectorAll('[data-statement]').forEach(function (el) {
      var words = el.querySelectorAll('.cs-word');
      if (words.length) statements.push({ el: el, words: words, top: 0, height: 0, lit: -1 });
    });

    pinGroups = collectGroup('.cs-pin-list', '.cs-pin-item');
    trackGroups = collectGroup('.cs-track', '.cs-track-row');

    var bar = document.querySelector('.cs-progress span');
    if (bar) progressBar = bar;

    var railSection = document.querySelector('[data-rail]');
    if (railSection) {
      var viewport = railSection.querySelector('.cs-rail-wrap');
      var track = railSection.querySelector('.cs-rail');
      if (viewport && track) {
        rail = { section: railSection, viewport: viewport, track: track, active: false, travel: 0, top: 0 };
      }
    }

    measure();
    window.addEventListener('scroll', wake, { passive: true });

    window.addEventListener('resize', debounce(measure, 150));
    window.addEventListener('orientationchange', debounce(measure, 300));
    window.addEventListener('load', measure);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);

    if (reduceQuery.addEventListener) {
      reduceQuery.addEventListener('change', function () {
        if (!reduceQuery.matches) return;
        plan.forEach(function (it) { it.state = 'done'; settle(it.el); });
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
