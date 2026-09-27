import { useEffect } from 'react';

/**
 * Confirmation that follows the eye, not the scroll position.
 *
 * Reported from real use: pressing Remind at the BOTTOM of the dues table gave
 * no visible response. It had worked — the confirmation was rendered near the
 * top of the page, hundreds of pixels above the button that was just clicked,
 * so the admin pressed it again and still saw nothing.
 *
 * Feedback that appears outside the viewport is the same as no feedback, and
 * worse than none for anything that sends email: the natural response to
 * silence is to press again.
 *
 * Fixed to the viewport, so it is seen wherever the action was taken.
 */
export function Toast({
  message,
  tone = 'good',
  onDone,
}: {
  message: string | null;
  tone?: 'good' | 'bad';
  onDone: () => void;
}) {
  useEffect(() => {
    if (!message) return;
    // Long enough to read a sentence; short enough not to sit over the table.
    // Cleared on change too, so a second action cannot be dismissed early by
    // the first one's timer.
    const t = setTimeout(onDone, 5000);
    return () => clearTimeout(t);
  }, [message, onDone]);

  if (!message) return null;

  return (
    <div
      // Announced to screen readers as well as shown: an admin who cannot see
      // the toast still needs to know the email went.
      role="status"
      aria-live="polite"
      className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 animate-[fadeIn_120ms_ease-out]"
    >
      <div
        className={`flex items-center gap-3 rounded-[14px] px-5 py-3.5 text-[13px] font-bold shadow-lg ${
          tone === 'bad' ? 'bg-coral-ink text-canvas' : 'bg-ink text-canvas'
        }`}
      >
        <span>{message}</span>
        <button
          type="button"
          onClick={onDone}
          aria-label="Dismiss"
          className="text-[16px] leading-none opacity-60 hover:opacity-100"
        >
          ×
        </button>
      </div>
    </div>
  );
}
