/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['Anton', 'Impact', 'sans-serif'],
        sans: ['"Space Grotesk"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"Space Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        ink: '#0B0B0B',
        paper: '#FFFDF5',
        asphalt: '#26241F',
        // The escort is the shared continuity proof: the one expensive thing on the page, and the
        // only thing allowed to be this colour.
        escort: { DEFAULT: '#FFD84D', deep: '#F5B800' },
        // One flat block per subscribing app, so a fact's destination is readable at a glance.
        passport: '#B8FF9F',
        escrow: '#A6FAFF',
        council: '#C9A6FF',
        refused: '#FF9F9F',
      },
      boxShadow: {
        hard: '4px 5px 0 #0B0B0B',
        'hard-lg': '7px 8px 0 #0B0B0B',
        'hard-sm': '2px 3px 0 #0B0B0B',
      },
      keyframes: {
        lane: { from: { backgroundPosition: '0 0' }, to: { backgroundPosition: '-96px 0' } },
      },
      animation: { lane: 'lane 1.6s linear infinite' },
    },
  },
  plugins: [],
};
