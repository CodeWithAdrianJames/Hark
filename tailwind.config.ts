import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        'hark-navy': '#292966',
        'hark-navy-hover': '#1F1F4D',
        'hark-purple': '#5C5C99',
        'hark-muted': '#A3A3CC',
        'hark-light': '#CCCCFF',
        'hark-bg': '#F8F9FD',
      },
    },
  },
  plugins: [],
};

export default config;
