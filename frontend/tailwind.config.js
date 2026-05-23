/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        'portal-bg':      'var(--bg)',
        'portal-bg2':     'var(--bg2)',
        'portal-bg3':     'var(--bg3)',
        'portal-sidebar': 'var(--sidebar)',
        'portal-border':  'var(--border)',
        'portal-border2': 'var(--border2)',
        'portal-text':    'var(--text)',
        'portal-text2':   'var(--text2)',
        'portal-text3':   'var(--text3)',
        'portal-white':   'var(--white)',
        'portal-accent':  'var(--accent)',
        'portal-green':   'var(--green)',
        'portal-red':     'var(--red)',
        'portal-blue':    'var(--blue)',
        'portal-yellow':  'var(--yellow)',
        // PROJ-58: Semantische Aliase – nutzen die gleichen CSS-Variablen
        'portal-warn':    'var(--yellow)',
        'portal-success': 'var(--green)',
        'portal-danger':  'var(--red)',
        'portal-info':    'var(--blue)',
      },
    },
  },
  plugins: [],
}
