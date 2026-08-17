/** @type {import('tailwindcss').Config} */
// Same tokens as the mobile apps so the three surfaces read as one product.
// Plain Tailwind here, not NativeWind — NativeWind targets React Native only.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#16181c',
        'ink-2': '#23262b',     // sidebar card
        'ink-3': '#31353b',     // sidebar button
        canvas: '#f7f9fb',
        card: '#ffffff',
        field: '#eef1f5',
        line: '#eceff3',        // card border
        muted: '#656c74',
        'muted-2': '#8d9299',   // on dark
        lime: '#cdf24a',
        'lime-soft': '#eaf3d6', // admitted chip
        'lime-ink': '#3f4a22',
        coral: '#ff6b57',
        'coral-soft': '#ffe2dc',
        'coral-ink': '#a33c2b',
        hair: '#f1f4f7',
      },
      fontFamily: { sans: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'] },
      borderRadius: { card: '20px', shell: '34px', pane: '26px', chip: '999px' },
      letterSpacing: { tight: '-0.02em', label: '0.08em', code: '0.06em' },
    },
  },
  plugins: [],
};
