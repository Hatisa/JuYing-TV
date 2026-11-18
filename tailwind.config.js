/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: { 50:'#fff1f2',100:'#ffe4e6',200:'#fecdd3',300:'#fda4af',400:'#fb7185',500:'#f43f5e',600:'#e11d48',700:'#be123c',800:'#9f1239',900:'#881337' },
        ink: { 900:'#08090c', 850:'#0c0e13', 800:'#11141b', 700:'#171b24', 600:'#222733', 500:'#2e3442' }
      },
      fontFamily: { sans: ['"HarmonyOS Sans SC"','"Microsoft YaHei UI"','"PingFang SC"','system-ui','sans-serif'] },
      boxShadow: { glow: '0 0 24px rgba(244,63,94,.35)', card: '0 8px 30px rgba(0,0,0,.35)' },
      animation: { 'fade-in': 'fadeIn .25s ease-out', 'slide-up': 'slideUp .3s cubic-bezier(.16,1,.3,1)', shimmer: 'shimmer 1.6s linear infinite' },
      keyframes: {
        fadeIn: { from: { opacity: '0' }, to: { opacity: '1' } },
        slideUp: { from: { opacity: '0', transform: 'translateY(12px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        shimmer: { from: { backgroundPosition: '-200% 0' }, to: { backgroundPosition: '200% 0' } }
      }
    }
  },
  plugins: []
};
