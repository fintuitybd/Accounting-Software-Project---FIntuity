/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          'Manrope',
          'Hind Siliguri',
          'Inter',
          'Noto Sans Bengali',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'sans-serif',
        ],
        display: ['Manrope', 'Hind Siliguri', 'Inter', 'Noto Sans Bengali', 'system-ui', 'sans-serif'],
        serif: ['Georgia', 'Times New Roman', 'serif'],
        bangla: ['Hind Siliguri', 'Noto Sans Bengali', 'Manrope', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
        /* Modern Quiet Ledger font stack with Manrope & Hind Siliguri */
        'ql-sans': ['Manrope', 'Hind Siliguri', 'Inter', 'Noto Sans Bengali', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        'ql-bangla': ['Hind Siliguri', 'Noto Sans Bengali', 'Inter', 'system-ui', 'sans-serif'],
        'ql-mono': ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      colors: {
        /* Semantic, theme-aware surfaces. The CSS variables flip under `.dark` / `.hc`. */
        canvas: 'rgb(var(--ql-paper) / <alpha-value>)',
        surface: {
          DEFAULT: 'rgb(var(--ql-surface) / <alpha-value>)',
          2: 'rgb(var(--ql-surface-muted) / <alpha-value>)',
          3: 'rgb(var(--ql-surface-muted) / <alpha-value>)',
        },
        line: {
          DEFAULT: 'rgb(var(--ql-border) / <alpha-value>)',
          strong: 'rgb(var(--ql-border-strong) / <alpha-value>)',
        },
        brand: {
          DEFAULT: 'rgb(var(--ql-brand) / <alpha-value>)',
          deep: 'rgb(var(--ql-brand-hover) / <alpha-value>)',
          bright: 'rgb(var(--ql-accent) / <alpha-value>)',
          soft: 'rgb(var(--ql-brand-soft) / <alpha-value>)',
        },
        saffron: {
          DEFAULT: 'rgb(var(--ql-accent) / <alpha-value>)',
          soft: 'rgb(var(--ql-accent-soft) / <alpha-value>)',
          deep: 'rgb(var(--ql-accent) / <alpha-value>)',
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
        /* Primary ramp — logo navy. Kept under the historical `vault` name so every workspace
           inherits the new brand without a single mechanical rename. */
        vault: {
          950: '#04111E',
          900: '#062038',
          800: '#002D60',
          700: '#00447F',
          600: '#005A9E',
          500: '#0075B8',
          400: '#3D9BD1',
          300: '#7CC1E4',
          200: '#B8DEF0',
          100: '#E1F1F8',
          50: '#F2F9FC',
        },
        /* Secondary ramp — logo teal (treasury / accents). */
        gold: {
          700: '#006B62',
          600: '#007A70',
          500: '#009688',
          400: '#00B0A0',
          300: '#4DCFC3',
          200: '#99E5DE',
          100: '#CCF2EE',
          50: '#EEFBF9',
        },
        /* Quiet Ledger semantic palette. Every value is a CSS variable in index.css; components
           must use these names rather than raw hex values. */
        ql: {
          paper: 'rgb(var(--ql-paper) / <alpha-value>)',
          surface: {
            DEFAULT: 'rgb(var(--ql-surface) / <alpha-value>)',
            muted: 'rgb(var(--ql-surface-muted) / <alpha-value>)',
            raised: 'rgb(var(--ql-surface-raised) / <alpha-value>)',
          },
          ink: {
            DEFAULT: 'rgb(var(--ql-ink) / <alpha-value>)',
            muted: 'rgb(var(--ql-ink-muted) / <alpha-value>)',
            subtle: 'rgb(var(--ql-ink-subtle) / <alpha-value>)',
            inverse: 'rgb(var(--ql-ink-inverse) / <alpha-value>)',
          },
          border: {
            DEFAULT: 'rgb(var(--ql-border) / <alpha-value>)',
            strong: 'rgb(var(--ql-border-strong) / <alpha-value>)',
          },
          brand: {
            DEFAULT: 'rgb(var(--ql-brand) / <alpha-value>)',
            hover: 'rgb(var(--ql-brand-hover) / <alpha-value>)',
            soft: 'rgb(var(--ql-brand-soft) / <alpha-value>)',
            ink: 'rgb(var(--ql-brand-ink) / <alpha-value>)',
          },
          accent: {
            DEFAULT: 'rgb(var(--ql-accent) / <alpha-value>)',
            soft: 'rgb(var(--ql-accent-soft) / <alpha-value>)',
          },
          success: {
            DEFAULT: 'rgb(var(--ql-success) / <alpha-value>)',
            soft: 'rgb(var(--ql-success-soft) / <alpha-value>)',
          },
          warning: {
            DEFAULT: 'rgb(var(--ql-warning) / <alpha-value>)',
            soft: 'rgb(var(--ql-warning-soft) / <alpha-value>)',
          },
          danger: {
            DEFAULT: 'rgb(var(--ql-danger) / <alpha-value>)',
            soft: 'rgb(var(--ql-danger-soft) / <alpha-value>)',
          },
          info: {
            DEFAULT: 'rgb(var(--ql-info) / <alpha-value>)',
            soft: 'rgb(var(--ql-info-soft) / <alpha-value>)',
          },
          focus: 'rgb(var(--ql-focus) / <alpha-value>)',
        },
      },
      boxShadow: {
        card: 'var(--ql-shadow-card)',
        'card-hover': 'var(--ql-shadow-card)',
        lift: 'var(--ql-shadow-card)',
        panel: 'var(--ql-shadow-popover)',
        glow: 'var(--ql-shadow-brand)',
        'glow-saffron': '0 0 0 1px rgba(168, 85, 247, 0.16), 0 18px 50px -24px rgba(168, 85, 247, 0.5)',
        'inner-top': 'inset 0 1px 0 rgba(255, 255, 255, 0.09)',
        pop: '0 32px 90px -30px rgba(9, 9, 20, 0.4), 0 2px 8px rgba(9, 9, 20, 0.08)',
        soft: '0 1px 2px rgba(16, 16, 30, 0.03), 0 12px 32px -16px rgba(16, 16, 30, 0.12)',
        'ql-card': 'var(--ql-shadow-card)',
        'ql-popover': 'var(--ql-shadow-popover)',
        'ql-brand': 'var(--ql-shadow-brand)',
      },
      letterSpacing: {
        display: '-0.03em',
        tighter2: '-0.045em',
      },
      borderRadius: {
        '4xl': '2rem',
        '5xl': '2.75rem',
        ql: 'var(--ql-radius-card)',
        'ql-control': 'var(--ql-radius-control)',
        'ql-modal': 'var(--ql-radius-modal)',
      },
      screens: {
        'ql-xs': '360px',
        'ql-3xl': '1440px',
        'ql-4xl': '1600px',
      },
      transitionTimingFunction: {
        'out-expo': 'cubic-bezier(0.16, 1, 0.3, 1)',
        spring: 'cubic-bezier(0.22, 1.2, 0.36, 1)',
        'ql-out': 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
      transitionDuration: {
        'ql-fast': '120ms',
        ql: '180ms',
        'ql-slow': '220ms',
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
