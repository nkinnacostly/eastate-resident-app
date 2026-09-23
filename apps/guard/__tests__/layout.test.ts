import {
  TAB_BAR_BOTTOM,
  TAB_BAR_CLEARANCE,
  TAB_BAR_GAP,
  TAB_BAR_HEIGHT,
} from '@/components/ui';

/**
 * The floating nav bar overlaps whatever is under it, so every tab screen has
 * to reserve space for it by hand. That reservation used to be a literal in
 * each screen -- 70px on the keypad, 112px on Log and Shift -- and 70 was
 * exactly wrong: the bar's top edge sits at bottom(20) + height(58) = 78px
 * above the screen edge, and the keypad reserved 70 plus 8 of padding. The
 * Check key, the most-tapped control in the app, finished flush against the
 * tab that navigates away from it.
 *
 * Nothing in a render test can catch that -- jest does no layout -- so the
 * arithmetic is pinned here instead. A number is easy to "tidy" later without
 * realising three screens and a gate depend on it.
 */
describe('tab bar clearance', () => {
  it('leaves a real gap rather than finishing flush against the bar', () => {
    expect(TAB_BAR_CLEARANCE).toBeGreaterThan(TAB_BAR_BOTTOM + TAB_BAR_HEIGHT);
  });

  it('is exactly the bar plus its offset plus the intended gap', () => {
    expect(TAB_BAR_CLEARANCE).toBe(TAB_BAR_HEIGHT + TAB_BAR_BOTTOM + TAB_BAR_GAP);
  });

  // A thumb reaching for Check should not be able to land on Log. Below about
  // a centimetre the two read as one control on a phone held one-handed at a
  // gate, which is the situation this app is only ever used in.
  it('keeps the gap large enough to be a target boundary, not a hairline', () => {
    expect(TAB_BAR_GAP).toBeGreaterThanOrEqual(16);
  });
});
