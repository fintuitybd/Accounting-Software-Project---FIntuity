/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          'Plus Jakarta Sans',
          'Hind Siliguri',
          'Noto Sans Bengali',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'sans-serif',
        ],
        display: [
          'Plus Jakarta Sans',
          'Hind Siliguri',
          'Noto Sans Bengali',
          'system-ui',
          'sans-serif',
        ],
        serif: ['Instrument Serif', 'Georgia', 'serif'],
        bangla: ['Hind Siliguri', 'Noto Sans Bengali', 'Plus Jakarta Sans', 'sans-serif'],
        mono: ['IBM Plex Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      colors: {
        /* Semantic, theme-aware surfaces. The CSS variables flip under `.dark` / `.hc`. */
        canvas: 'rgb(var(--lv-canvas) / <alpha-value>)',
        surface: {
          DEFAULT: 'rgb(var(--lv-surface) / <alpha-value>)',
          2: 'rgb(var(--lv-surface-2) / <alpha-value>)',
          3: 'rgb(var(--lv-surface-3) / <alpha-value>)',
        },
        line: {
          DEFAULT: 'rgb(var(--lv-line) / <alpha-value>)',
          strong: 'rgb(var(--lv-line-strong) / <alpha-value>)',
        },
        brand: {
          DEFAULT: 'rgb(var(--lv-emerald) / <alpha-value>)',
          deep: 'rgb(var(--lv-emerald-deep) / <alpha-value>)',
          bright: 'rgb(var(--lv-emerald-bright) / <alpha-value>)',
          soft: 'rgb(var(--lv-emerald-soft) / <alpha-value>)',
        },
        saffron: {
          DEFAULT: 'rgb(var(--lv-saffron) / <alpha-value>)',
          soft: 'rgb(var(--lv-saffron-soft) / <alpha-value>)',
          deep: 'rgb(var(--lv-saffron-deep) / <alpha-value>)',
        },
        ink: {
          950: 'rgb(var(--ink-950) / <alpha-value>)',
          900: 'rgb(var(--ink-900) / <alpha-value>)',
          800: 'rgb(var(--ink-800) / <alpha-value>)',
          700: 'rgb(var(--ink-700) / <alpha-value>)',
          600: 'rgb(var(--ink-600) / <alpha-value>)',
          500: 'rgb(var(--ink-500) / <alpha-value>)',
          400: 'rgb(var(--ink-400) / <alpha-value>)',
          300: 'rgb(var(--ink-300) / <alpha-value>)',
          200: 'rgb(var(--ink-200) / <alpha-value>)',
          100: 'rgb(var(--ink-100) / <alpha-value>)',
          50: 'rgb(var(--ink-50) / <alpha-value>)',
        },
        /* Primary ramp — electric indigo. Kept under the historical `vault` name so every
           workspace inherits the new brand without a single mechanical rename. */
        vault: {
          950: '#0A0A15',
          900: '#111128',
          800: '#1B1B45',
          700: '#2C2C70',
          600: '#4040A8',
          500: '#5A5AD6',
          400: '#8181F2',
          300: '#AFAFFA',
          200: '#D3D3FE',
          100: '#E9E9FF',
          50: '#F5F5FF',
        },
        /* Secondary ramp — orchid violet (treasury / accents). */
        gold: {
          700: '#7E22CE',
          600: '#9333EA',
          500: '#A855F7',
          400: '#C084FC',
          300: '#D8B4FE',
          200: '#E9D5FF',
          100: '#F3E8FF',
          50: '#FAF5FF',
        },
      },
      boxShadow: {
        card: 'var(--lv-shadow-card)',
        'card-hover': 'var(--lv-shadow-card-hover)',
        lift: 'var(--lv-shadow-lift)',
        panel: 'var(--lv-shadow-panel)',
        glow: 'var(--lv-shadow-glow)',
        'glow-saffron': '0 0 0 1px rgba(168, 85, 247, 0.16), 0 18px 50px -24px rgba(168, 85, 247, 0.5)',
        'inner-top': 'inset 0 1px 0 rgba(255, 255, 255, 0.09)',
        pop: '0 32px 90px -30px rgba(9, 9, 20, 0.4), 0 2px 8px rgba(9, 9, 20, 0.08)',
        soft: '0 1px 2px rgba(16, 16, 30, 0.03), 0 12px 32px -16px rgba(16, 16, 30, 0.12)',
      },
      letterSpacing: {
        display: '-0.03em',
        tighter2: '-0.045em',
      },
      borderRadius: {
        '4xl': '2rem',
        '5xl': '2.75rem',
      },
      transitionTimingFunction: {
        'out-expo': 'cubic-bezier(0.16, 1, 0.3, 1)',
        spring: 'cubic-bezier(0.22, 1.2, 0.36, 1)',
      },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '-700px 0' },
          '100%': { backgroundPosition: '700px 0' },
        },
        floaty: {
          '0%,100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-5px)' },
        },
        pulseSoft: {
          '0%,100%': { opacity: '1' },
          '50%': { opacity: '0.5' },
        },
        pulseRing: {
          '0%': { transform: 'scale(0.85)', opacity: '0.65' },
          '70%': { transform: 'scale(1.9)', opacity: '0' },
          '100%': { transform: 'scale(1.9)', opacity: '0' },
        },
        drift: {
          '0%,100%': { transform: 'translate3d(0,0,0) scale(1)' },
          '50%': { transform: 'translate3d(3%, -4%, 0) scale(1.06)' },
        },
        sheen: {
          '0%': { transform: 'translateX(-130%) skewX(-16deg)' },
          '60%,100%': { transform: 'translateX(230%) skewX(-16deg)' },
        },
        rise: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        aurora: {
          '0%,100%': { transform: 'translate3d(-4%, -2%, 0) scale(1)' },
          '50%': { transform: 'translate3d(5%, 4%, 0) scale(1.12)' },
        },
      },
      animation: {
        shimmer: 'shimmer 2.2s linear infinite',
        floaty: 'floaty 6s ease-in-out infinite',
        pulseSoft: 'pulseSoft 2.4s ease-in-out infinite',
        'pulse-ring': 'pulseRing 2.8s cubic-bezier(0.16,1,0.3,1) infinite',
        drift: 'drift 18s ease-in-out infinite',
        sheen: 'sheen 4.8s cubic-bezier(0.16,1,0.3,1) infinite',
        rise: 'rise 0.5s cubic-bezier(0.16,1,0.3,1) both',
        aurora: 'aurora 22s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
