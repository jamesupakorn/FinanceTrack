import {
  FOCUSABLE_SELECTOR,
  getTabbableElements
} from '../../../../src/shared/utils/frontend/focusTrap';

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
    const paragraph = document.createElement('p');
    paragraph.textContent = 'just some text';
    const span = document.createElement('span');
    span.textContent = 'more text';
    container.appendChild(paragraph);
    container.appendChild(span);
    expect(getTabbableElements(container)).toEqual([]);
  });
});

describe('getTabbableElements — jsdom geometry defaults (pre-flight)', () => {
  it('a plain, un-stubbed element has offsetParent === null and an empty getClientRects() list', () => {
    const button = document.createElement('button');
    expect(button.offsetParent).toBeNull();
    expect(button.getClientRects().length).toBe(0);
  });
});

function makeVisible(element: HTMLElement): void {
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
    [button, input, select, textarea, anchor, tabbableDiv].forEach(element => {
      makeVisible(element);
      container.appendChild(element);
    });
    expect(getTabbableElements(container)).toEqual([button, input, select, textarea, anchor, tabbableDiv]);
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
    [first, current, third].forEach(element => {
      makeVisible(element);
      container.appendChild(element);
    });
    expect(getTabbableElements(container)).toEqual([current]);
  });

  it('mixed fixture: roving group between two normal elements returns exactly the tabbable three, in DOM order', () => {
    const container = document.createElement('div');
    const beforeButton = document.createElement('button');
    makeVisible(beforeButton);
    const rovingGroup = document.createElement('div');
    const rovingInactiveA = document.createElement('button');
    rovingInactiveA.setAttribute('tabindex', '-1');
    const rovingCurrentItem = document.createElement('button');
    rovingCurrentItem.setAttribute('tabindex', '0');
    const rovingInactiveB = document.createElement('button');
    rovingInactiveB.setAttribute('tabindex', '-1');
    [rovingInactiveA, rovingCurrentItem, rovingInactiveB].forEach(element => {
      makeVisible(element);
      rovingGroup.appendChild(element);
    });
    const afterInput = document.createElement('input');
    makeVisible(afterInput);
    container.appendChild(beforeButton);
    container.appendChild(rovingGroup);
    container.appendChild(afterInput);
    expect(getTabbableElements(container)).toEqual([beforeButton, rovingCurrentItem, afterInput]);
  });
});

describe('getTabbableElements — geometry filter (jsdom-limitation-motivated)', () => {
  it('normal/visible (offsetParent stubbed non-null) is included, display:none-simulated sibling is excluded', () => {
    const container = document.createElement('div');
    const visibleButton = document.createElement('button');
    makeVisible(visibleButton);
    const hiddenButton = document.createElement('button');
    container.appendChild(visibleButton);
    container.appendChild(hiddenButton);
    expect(getTabbableElements(container)).toEqual([visibleButton]);
  });

  it('position:fixed-simulated (getClientRects stubbed non-empty, offsetParent left null) is included', () => {
    const container = document.createElement('div');
    const fixedButton = document.createElement('button');
    Object.defineProperty(fixedButton, 'getClientRects', {
      value: () => [{ width: 1, height: 1 }],
      configurable: true
    });
    container.appendChild(fixedButton);
    expect(getTabbableElements(container)).toEqual([fixedButton]);
  });
});