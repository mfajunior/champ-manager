/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      // Tokens tirados de uma referência visual (ver claude/champy-decisoes-arquitetura.md,
      // seção 9, no projeto) — não do template em si, só cor e tipografia.
      colors: {
        background: '#fcfdff',
        foreground: '#0c142d',
        card: '#f5f7f9',
        border: '#d7dbe0',
        brand: {
          DEFAULT: '#b31220',
          foreground: '#fcfdff',
        },
        secondary: {
          DEFAULT: '#101933',
          foreground: '#fcfdff',
        },
        muted: {
          DEFAULT: '#e8ebef',
          foreground: '#555e6c',
        },
        destructive: {
          // Ajustado a partir da referência: o valor original colidia com o
          // brand, e a primeira alternativa testada (#0c142d) colidia com o
          // foreground. #d43628 passa 4.5:1 de contraste (WCAG AA) nos dois usos.
          DEFAULT: '#d43628',
          foreground: '#ffffff',
        },
      },
      fontFamily: {
        sans: ['Barlow', 'sans-serif'],
        display: ['"Bebas Neue"', 'sans-serif'],
      },
      borderRadius: {
        // Identidade visual da referência: nenhum componente tem cantos
        // arredondados. Redefinir a escala inteira pra zero evita que alguém
        // use "rounded-md" por hábito e quebre essa consistência sem perceber.
        none: '0',
        sm: '0',
        DEFAULT: '0',
        md: '0',
        lg: '0',
        xl: '0',
        full: '9999px', // mantido só para avatares/badges circulares, se precisar
      },
    },
  },
  plugins: [],
}
