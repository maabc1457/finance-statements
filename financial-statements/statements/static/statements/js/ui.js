// Wires the lever controls to the calculation engine. Dragging a slider only
// updates its own live label; releasing it (the "change" event) commits the
// new lever value and plays a ~5-6s traced reveal of every line item that
// moved, in statement order (Income Statement -> Cash Flow -> Balance Sheet),
// with a delta badge that appears next to each number and then gets absorbed
// into it. All controls are locked for the duration so a new change can't be
// started mid-flow.

(function () {
  // These are always non-negative magnitudes by construction (a % of
  // revenue, a % of debt, or a lever whose slider bottoms out at 0), so
  // they're always shown as a flat outflow/inflow regardless of what else
  // changed.
  const ALWAYS_NEGATIVE = new Set(['is_cogs', 'is_opex', 'is_depreciation', 'is_interest', 'cf_cfi', 'cf_dividends', 'bs_accum_dep']);
  const ALWAYS_POSITIVE = new Set(['cf_depreciation_addback']);

  // Debt issued/(repaid) can go either way depending on whether the Debt
  // lever sits above or below the opening balance, so it always carries an
  // explicit + (cash in) or - (cash out).
  const EXPLICIT_SIGN = new Set(['cf_debt_change']);

  // Tax is the exception: it's EBT * 25%, and EBT can go negative (heavy
  // Depreciation + Interest against a small Operating Income), which flips Tax into a
  // benefit. It's still always "the amount separating EBT from Net Income",
  // so it displays as subtracted (-) when positive and added back (+) when
  // negative, rather than a fixed sign.
  const SUBTRACTED_DYNAMIC = new Set(['is_tax']);

  // How the reveal is paced, per Update/Learn mode (toggle in the top bar).
  //
  // Update mode splits one shared total across however many fields happen
  // to change - fine for a quick glance.
  //
  // Learn mode used to do the same thing, which was the actual bug: a
  // shared total divided by field count means each lever gets a DIFFERENT
  // per-item pace. CapEx only touches ~5 fields, so it read as slow and
  // deliberate - exactly the feel we want for a "learn" walkthrough.
  // Revenue touches ~16 fields, so the same shared total compressed its
  // pace - rushed, inconsistent, arbitrary. Learn mode instead uses a fixed
  // per-item pace (originally calibrated off CapEx's feel, now at 1.5x that
  // speed) for every lever instead of a shared total, so the per-item feel
  // is identical everywhere and the overall runtime naturally varies with
  // how many fields a given lever actually touches - a real per-slider
  // timeframe instead of a forced, arbitrary one.
  const MODE_TIMINGS = {
    update: { pacing: 'shared-total', total: 12000, badge: 11200 },
    learn: { pacing: 'fixed-step', step: 3889, badge: 19333 },
  };
  const SETTLE_BUFFER_MS = 300;

  let mode = 'update';
  let BADGE_VISIBLE_MS = MODE_TIMINGS[mode].badge;

  function setMode(nextMode) {
    mode = nextMode;
    BADGE_VISIBLE_MS = MODE_TIMINGS[mode].badge;
    document.getElementById('mode-label-update').classList.toggle('active', mode === 'update');
    document.getElementById('mode-label-learn').classList.toggle('active', mode === 'learn');
  }

  function stepMsFor(changedCount) {
    const cfg = MODE_TIMINGS[mode];
    return cfg.pacing === 'fixed-step' ? cfg.step : cfg.total / (changedCount + 1);
  }

  // Fields whose value is literally the same figure landing on another
  // statement (per the accounting flow: Net Income -> CFO / Retained
  // Earnings, Depreciation -> non-cash add-back / Accumulated Depreciation,
  // CapEx -> Gross PP&E, ending Cash -> Balance Sheet Cash). When one of these reveals, its source line item's
  // title pops at the same time so the cross-statement link is obvious.
  const CROSS_STATEMENT_LINKS = {
    cf_net_income: 'is_net_income',
    cf_depreciation_addback: 'is_depreciation',
    bs_cash: 'cf_cash_eoy',
    bs_retained_earnings: 'is_net_income',
    bs_gross_ppe: 'cf_cfi',
    bs_accum_dep: 'is_depreciation',
    bs_long_term_debt: 'cf_debt_change',
  };

  function jumpLabel(field) {
    const el = document.querySelector('[data-label-for="' + field + '"]');
    if (!el) return;
    el.classList.remove('jump');
    void el.offsetWidth; // restart the animation even if it's still playing
    el.classList.add('jump');
  }

  // Reveal order follows the actual accounting flow: Income Statement first,
  // then Cash Flow (which starts from Net Income), then the Balance Sheet
  // (which lands on both of those).
  const FLOW_ORDER = [
    'is_revenue', 'is_cogs', 'is_gross_profit', 'is_opex', 'is_operating_income',
    'is_depreciation', 'is_ebit', 'is_interest', 'is_ebt', 'is_tax', 'is_net_income',
    'cf_net_income', 'cf_depreciation_addback', 'cf_cfo', 'cf_cfi', 'cf_debt_change', 'cf_dividends', 'cf_cff',
    'cf_net_change', 'cf_cash_boy', 'cf_cash_eoy',
    'bs_cash', 'bs_receivables_inventory', 'bs_gross_ppe', 'bs_accum_dep', 'bs_net_ppe', 'bs_total_assets',
    'bs_long_term_debt', 'bs_total_liabilities', 'bs_common_stock', 'bs_retained_earnings', 'bs_total_liab_equity',
  ];

  const base = window.STATEMENT_BASE;
  const levers = Object.assign({}, window.STATEMENT_LEVERS);

  let lastValues = null;
  let animating = false;

  function formatMoney(value) {
    return Math.round(value).toLocaleString('en-US');
  }

  function formatDelta(delta) {
    const rounded = Math.round(delta);
    if (rounded === 0) return null;
    return (rounded > 0 ? '+' : '−') + formatMoney(Math.abs(rounded));
  }

  function setLeverLabels() {
    document.getElementById('revenue-val').textContent = '$' + formatMoney(levers.revenue);
    document.getElementById('capex-val').textContent = '$' + formatMoney(levers.capex);
    document.getElementById('useful-life-val').textContent = levers.useful_life + ' yrs';
    document.getElementById('debt-val').textContent = '$' + formatMoney(levers.debt);

    const eff = EFFICIENCY_TABLE[levers.efficiency];
    document.getElementById('efficiency-val').textContent = eff.label;
    document.getElementById('efficiency-config').textContent =
      'COGS ' + Math.round(eff.cogsPct * 100) + '% of Revenue · OpEx ' + Math.round(eff.opexPct * 100) + '% of Revenue';
  }

  function paintField(field, result) {
    const el = document.querySelector('[data-field="' + field + '"]');
    if (!el) return;
    const value = result[field];
    let text;
    if (ALWAYS_NEGATIVE.has(field)) {
      text = '−' + formatMoney(Math.abs(value));
    } else if (ALWAYS_POSITIVE.has(field)) {
      text = '+' + formatMoney(Math.abs(value));
    } else if (EXPLICIT_SIGN.has(field)) {
      text = (value > 0 ? '+' : value < 0 ? '−' : '') + formatMoney(Math.abs(value));
    } else if (SUBTRACTED_DYNAMIC.has(field)) {
      text = (value >= 0 ? '−' : '+') + formatMoney(Math.abs(value));
    } else {
      // Natural sign: subtotals like EBT or Net Income can genuinely go
      // negative, and should read as negative rather than being silently
      // shown as a positive number.
      text = (value < 0 ? '−' : '') + formatMoney(Math.abs(value));
    }
    el.textContent = text;

    // The "(6% x $debt)" note beside Interest expense updates together with
    // the interest figure itself, not while the slider is still being dragged.
    if (field === 'is_interest') {
      document.getElementById('interest-basis').textContent =
        '(' + Math.round(INTEREST_RATE * 100) + '% × $' + formatMoney(result.bs_long_term_debt) + ' debt)';
    }

    // Same idea for the straight-line notes: how this year's Depreciation was
    // worked out, and how many years of it the remaining Net PP&E covers.
    if (field === 'is_depreciation') {
      document.getElementById('depreciation-basis').textContent =
        '($' + formatMoney(result.bs_gross_ppe) + ' gross PP&E ÷ ' + result.is_useful_life + ' yrs, same every year)';
      document.getElementById('useful-life-info-example').textContent =
        '= ($' + formatMoney(base.gross_ppe_boy) + ' + $' + formatMoney(result.cf_cfi) + ') ÷ ' +
        result.is_useful_life + ' yrs = $' + formatMoney(result.is_depreciation) + ' per year';
      document.getElementById('useful-life-info-gap').textContent =
        "Why it's less than " + result.is_useful_life + ' − 1: the $' + formatMoney(base.accum_dep_boy) +
        ' of prior-year depreciation has already used up $' + formatMoney(base.accum_dep_boy) + ' ÷ $' +
        formatMoney(result.is_depreciation) + ' ≈ ' + (base.accum_dep_boy / result.is_depreciation).toFixed(1) +
        ' years of book value.';
    }
    if (field === 'bs_accum_dep') {
      document.getElementById('accum-dep-basis').textContent =
        '($' + formatMoney(base.accum_dep_boy) + ' prior years, fixed + $' + formatMoney(result.is_depreciation) + ' this year)';
    }
    if (field === 'bs_net_ppe') {
      document.getElementById('remaining-life').textContent =
        "At this year's charge, Net PP&E lasts ≈ " + result.bs_remaining_life.toFixed(1) + ' more years';
    }
  }

  function paintAll(result) {
    document.querySelectorAll('[data-field]').forEach((el) => paintField(el.dataset.field, result));
  }

  function setLocked(locked) {
    animating = locked;
    document.querySelectorAll('#controls input[type=range]').forEach((el) => { el.disabled = locked; });
    document.getElementById('controls').classList.toggle('locked', locked);
    document.getElementById('flow-indicator').hidden = !locked;
    document.getElementById('mode-switch').disabled = locked;
    if (locked) setUsefulLifeInfo(false);
  }

  // (i) note beside Useful Life: toggles on click, closes on Escape or a
  // click anywhere else, and is closed while a change is playing out.
  const infoBtn = document.getElementById('useful-life-info-btn');
  const infoPop = document.getElementById('useful-life-info');

  function setUsefulLifeInfo(open) {
    infoPop.hidden = !open;
    infoBtn.setAttribute('aria-expanded', String(open));
  }

  infoBtn.addEventListener('click', (e) => {
    e.preventDefault();
    setUsefulLifeInfo(infoPop.hidden);
  });
  document.addEventListener('click', (e) => {
    if (!infoPop.hidden && !infoPop.contains(e.target) && e.target !== infoBtn) setUsefulLifeInfo(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !infoPop.hidden) {
      setUsefulLifeInfo(false);
      infoBtn.focus();
    }
  });

  function revealField(field, oldResult, newResult, changedSet) {
    const numEl = document.querySelector('[data-field="' + field + '"]');
    const badgeEl = document.querySelector('[data-badge-for="' + field + '"]');
    if (!numEl || !badgeEl) return;

    const delta = newResult[field] - oldResult[field];
    const up = delta > 0;

    badgeEl.textContent = formatDelta(delta);
    badgeEl.classList.remove('up', 'down');
    badgeEl.classList.add(up ? 'up' : 'down', 'show');
    numEl.classList.add(up ? 'flash-up' : 'flash-down');

    // This value is the same figure that just arrived from another
    // statement - pop both titles together so the link reads clearly.
    const source = CROSS_STATEMENT_LINKS[field];
    if (source && changedSet.has(source)) {
      jumpLabel(field);
      jumpLabel(source);
    }

    setTimeout(() => {
      paintField(field, newResult);
      badgeEl.classList.remove('show');
      setTimeout(() => {
        numEl.classList.remove('flash-up', 'flash-down');
        badgeEl.textContent = '';
      }, 400);
    }, BADGE_VISIBLE_MS);
  }

  function runFlow(newResult) {
    const oldResult = lastValues;

    const changed = FLOW_ORDER.filter((field) => formatDelta(newResult[field] - oldResult[field]) !== null);

    if (changed.length === 0) {
      lastValues = newResult;
      return;
    }

    setLocked(true);
    const changedSet = new Set(changed);
    const stepMs = stepMsFor(changed.length);
    changed.forEach((field, i) => {
      setTimeout(() => revealField(field, oldResult, newResult, changedSet), stepMs * i);
    });

    setTimeout(() => {
      paintAll(newResult);
      lastValues = newResult;
      setLocked(false);
    }, stepMs * changed.length + BADGE_VISIBLE_MS + SETTLE_BUFFER_MS);
  }

  function bind(id, key, transform) {
    const el = document.getElementById(id);
    el.addEventListener('input', () => {
      levers[key] = transform ? transform(el.value) : Number(el.value);
      setLeverLabels();
    });
    el.addEventListener('change', () => {
      if (animating) return;
      if (window.posthog) posthog.capture('lever_changed', { lever: key, value: levers[key], mode });
      runFlow(computeStatements(base, levers));
    });
  }

  bind('revenue-lever', 'revenue');
  bind('capex-lever', 'capex');
  bind('useful-life-lever', 'useful_life');
  bind('efficiency-lever', 'efficiency');
  bind('debt-lever', 'debt');

  document.getElementById('mode-switch').addEventListener('change', (e) => {
    setMode(e.target.checked ? 'learn' : 'update');
    if (window.posthog) posthog.capture('mode_toggled', { mode });
  });

  // Pin the caption's width to exactly the toggle row's rendered width, so
  // its box starts at "Update Mode" and ends at "Learn Mode" - never wider -
  // wrapping onto extra lines instead of stretching out past the toggle.
  function syncModeCaptionWidth() {
    const toggle = document.querySelector('.mode-toggle');
    const caption = document.getElementById('mode-caption');
    if (toggle && caption) caption.style.width = toggle.offsetWidth + 'px';
  }
  syncModeCaptionWidth();
  window.addEventListener('resize', syncModeCaptionWidth);

  setLeverLabels();
  lastValues = computeStatements(base, levers);
  paintAll(lastValues);
})();
