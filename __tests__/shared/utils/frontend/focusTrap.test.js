import {
  FOCUSABLE_SELECTOR,
  getTabbableElements
} from '../../../../src/shared/utils/frontend/focusTrap';

// focusTrap.js has zero imports/dependencies of its own — no jest.mock() needed here.

describe('FOCUSABLE_SELECTOR', () => {
  it('contains each of the six documented selector clauses', () => {
    const clauses = FOCUSABLE_SELECTOR.split(', ');

    expect(clauses).toContain('button:not([disabled])');
    expect(clauses).toContain('input:not([disabled])');
    expect(clauses).toContain('select:not([disabled])');
    expect(clauses).toContain('textarea:not([disabled])');
    expect(clauses).toContain('a[href]');
    expect(clauses).toContain('[tabindex]');
  });
});

describe('getTabbableElements — guard clause', () => {
  it('returns [] for a null root', () => {
    expect(getTabbableElements(null)).toEqual([]);
  });

  it('returns [] for an undefined root', () => {
    expect(getTabbableElements(undefined)).toEqual([]);
  });

  it('returns [] for a root with no matching descendants', () => {
    const container = document.createElement('div');
    const p = document.createElement('p');
    p.textContent = 'just some text';
    const span = document.createElement('span');
    span.textContent = 'more text';
    container.appendChild(p);
    container.appendChild(span);

    expect(getTabbableElements(container)).toEqual([]);
  });
});

// Pre-flight check (spec §Design): confirmed empirically before writing the geometry tests below
// that jsdom's real, un-stubbed defaults for a plain element are offsetParent === null and
// getClientRects().length === 0 — exactly as task-context's table assumed. No adjustment to the
// stub design (below) was needed as a result.
describe('getTabbableElements — jsdom geometry defaults (pre-flight, documents the environment assumption)', () => {
  it('a plain, un-stubbed element has offsetParent === null and an empty getClientRects() list', () => {
    const btn = document.createElement('button');

    expect(btn.offsetParent).toBeNull();
    expect(btn.getClientRects().length).toBe(0);
  });
});

/**
 * Stubs offsetParent so an element reads as "normal/visible" under jsdom (which has no layout
 * engine and so never computes a real offsetParent). Scoped to this one element only — never
 * applied at module scope or on HTMLElement.prototype.
 */
function makeVisible(element) {
  Object.defineProperty(element, 'offsetParent', {
    get: () => document.body,
    configurable: true
  });
}

describe('getTabbableElements — selector matching', () => {
  it('returns all six selector-matched types when each is present and visible', () => {
    const container = document.createElement('div');

    const button = document.createElement('button');
    const input = document.createElement('input');
    const select = document.createElement('select');
    const textarea = document.createElement('textarea');
    const anchor = document.createElement('a');
    anchor.setAttribute('href', '#section');
    const tabbableDiv = document.createElement('div');
    tabbableDiv.setAttribute('tabindex', '0');

    [button, input, select, textarea, anchor, tabbableDiv].forEach(el => {
      makeVisible(el);
      container.appendChild(el);
    });

    const result = getTabbableElements(container);

    expect(result).toHaveLength(6);
    expect(result).toEqual([button, input, select, textarea, anchor, tabbableDiv]);
  });

  it('excludes an <a> without an href attribute, but includes a sibling <a href="...">', () => {
    const container = document.createElement('div');

    const anchorNoHref = document.createElement('a');
    anchorNoHref.textContent = 'styled as a link, but JS-driven';
    makeVisible(anchorNoHref);

    const anchorWithHref = document.createElement('a');
    anchorWithHref.setAttribute('href', '#target');
    makeVisible(anchorWithHref);

    container.appendChild(anchorNoHref);
    container.appendChild(anchorWithHref);

    expect(getTabbableElements(container)).toEqual([anchorWithHref]);
  });

  it('excludes a button[disabled], but includes a sibling enabled button', () => {
    const container = document.createElement('div');

    const disabledButton = document.createElement('button');
    disabledButton.disabled = true;
    makeVisible(disabledButton);

    const enabledButton = document.createElement('button');
    makeVisible(enabledButton);

    container.appendChild(disabledButton);
    container.appendChild(enabledButton);

    expect(getTabbableElements(container)).toEqual([enabledButton]);
  });
});

describe('getTabbableElements — tabIndex filter (BUG-4 / TD-M06 regression class)', () => {
  it('excludes an element that matches the selector via [tabindex] but has tabindex="-1"', () => {
    const container = document.createElement('div');

    const rovingInactive = document.createElement('div');
    rovingInactive.setAttribute('tabindex', '-1');
    makeVisible(rovingInactive);

    container.appendChild(rovingInactive);

    expect(getTabbableElements(container)).toEqual([]);
  });

  it('roving-tabindex group: returns only the one button with tabindex="0", not the other two', () => {
    const container = document.createElement('div');

    const first = document.createElement('button');
    first.setAttribute('tabindex', '-1');
    const current = document.createElement('button');
    current.setAttribute('tabindex', '0');
    const third = document.createElement('button');
    third.setAttribute('tabindex', '-1');

    [first, current, third].forEach(el => {
      makeVisible(el);
      container.appendChild(el);
    });

    expect(getTabbableElements(container)).toEqual([current]);
  });

  it('mixed fixture: roving group between two normal elements returns exactly the tabbable three, in DOM order', () => {
    const container = document.createElement('div');

    const beforeButton = document.createElement('button');
    makeVisible(beforeButton);

    // Roving-tabindex group (same shape as the test above): only `rovingCurrentItem` is tabbable.
    const rovingGroup = document.createElement('div');
    const rovingInactiveA = document.createElement('button');
    rovingInactiveA.setAttribute('tabindex', '-1');
    const rovingCurrentItem = document.createElement('button');
    rovingCurrentItem.setAttribute('tabindex', '0');
    const rovingInactiveB = document.createElement('button');
    rovingInactiveB.setAttribute('tabindex', '-1');
    [rovingInactiveA, rovingCurrentItem, rovingInactiveB].forEach(el => {
      makeVisible(el);
      rovingGroup.appendChild(el);
    });

    const afterInput = document.createElement('input');
    makeVisible(afterInput);

    container.appendChild(beforeButton);
    container.appendChild(rovingGroup);
    container.appendChild(afterInput);

    const result = getTabbableElements(container);

    // Asserts on order, not just membership — the contract every caller's wrap-around
    // logic (result[0] / result[result.length - 1]) depends on.
    expect(result).toEqual([beforeButton, rovingCurrentItem, afterInput]);
  });
});

describe('getTabbableElements — geometry filter (jsdom-limitation-motivated)', () => {
  it('normal/visible (offsetParent stubbed non-null) is included, display:none-simulated sibling is excluded', () => {
    const container = document.createElement('div');

    // Normal/visible: offsetParent stubbed non-null per task-context's table.
    const visibleButton = document.createElement('button');
    makeVisible(visibleButton);

    // display:none-simulated: no stub at all — jsdom's real, un-stubbed default
    // (offsetParent === null, getClientRects().length === 0) coincides exactly with the
    // real-browser signal for display:none, per the pre-flight check above.
    const hiddenButton = document.createElement('button');

    container.appendChild(visibleButton);
    container.appendChild(hiddenButton);

    // Both states exercised within one call, proving the filter discriminates between them
    // rather than an all-hidden fixture happening to return [] for the wrong reason.
    expect(getTabbableElements(container)).toEqual([visibleButton]);
  });

  it('position:fixed-simulated (getClientRects stubbed non-empty, offsetParent left null) is included', () => {
    const container = document.createElement('div');

    const fixedButton = document.createElement('button');
    // position:fixed-simulated: offsetParent left at jsdom's default (null); getClientRects
    // stubbed non-empty. Production code only reads `.length`, so a plain array is sufficient
    // (no real DOMRectList needed). This is the OR-condition's second branch — the case that
    // would be wrongly excluded by an "AND" typo regression.
    fixedButton.getClientRects = () => [{ width: 1, height: 1 }];

    container.appendChild(fixedButton);

    expect(getTabbableElements(container)).toEqual([fixedButton]);
  });
});
