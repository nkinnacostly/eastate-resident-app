/** @type {import('tailwindcss').Config} */
// Design tokens transcribed from the Resident App design doc.
module.exports = {
  content: [
    './app/**/*.{js,jsx,ts,tsx}',
    './components/**/*.{js,jsx,ts,tsx}',
    './lib/**/*.{js,jsx,ts,tsx}',
  ],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        ink: '#16181c', // near-black: text, nav bar, "the code itself"
        canvas: '#f7f9fb', // screen background
        card: '#ffffff',
        field: '#eef1f5', // input / inert surface
        muted: '#8b9096', // secondary text
        lime: '#cdf24a', // "anything that moves you forward"
        hair: '#dfe4ea',

        // Guard-only. Coral is the refusal/degraded colour and is used NOWHERE
        // else — at a gate at 2am the guard reads colour before words, so it
        // must never appear on a screen that means "let them in".
        coral: '#ff6b57',
        'coral-ink': '#a33c2b', // text on a coral-tinted surface
        'coral-wash': '#fff2ef', // banner background
        'coral-chip': '#ffe2dc', // "Flagged" pill
        digit: '#eef4dd', // number keys, so glyph vs digit is visible at a glance
      },
      // React Native picks a font FILE, not a weight — so each weight is its
      // own family. Using font-<key> keeps that explicit; font-bold (a weight
      // utility) would silently do nothing useful here.
      fontFamily: {
        jk: ['PlusJakartaSans_400Regular'],
        'jk-md': ['PlusJakartaSans_500Medium'],
        'jk-sb': ['PlusJakartaSans_600SemiBold'],
        'jk-b': ['PlusJakartaSans_700Bold'],
        'jk-xb': ['PlusJakartaSans_800ExtraBold'],
      },
      // One type scale, so screens stop hard-coding a mock's pixel values.
      // The design was drawn at ~390pt wide; transcribing its literal px sizes
      // left every screen undersized on a 440pt device. These are the design's
      // proportions, re-based one step up, with leading baked in.
      fontSize: {
        display: ['30px', '34px'], // screen titles ("Welcome back")
        title: ['21px', '26px'], // card headlines, section heads
        body: ['15px', '22px'], // primary reading text and input values
        sub: ['13px', '20px'], // secondary / supporting copy
        micro: ['11.5px', '16px'], // timestamps, counters
        label: ['11px', '14px'], // uppercase eyebrows
      },
      maxWidth: {
        // A single measure shared by a headline and the copy under it. Two
        // different max-widths stacked is what makes a left-aligned block look
        // misaligned — the ragged right edges stop relating to each other.
        measure: '320px',
      },
      borderRadius: {
        card: '18px',
        field: '14px',
        nav: '24px',
        sheet: '26px',
        hero: '22px',
      },
      letterSpacing: {
        code: '3px', // the 6-char code, spaced so it reads aloud cleanly
        label: '1.1px', // uppercase eyebrow labels
        tight: '-0.02em',
      },
    },
  },
  plugins: [],
};
