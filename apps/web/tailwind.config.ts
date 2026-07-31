import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

/**
 * توکن‌های طراحی — منبع نهایی در `design-system/MASTER.md`.
 *
 * دو تصمیم که عمداً با پیش‌فرض Tailwind فرق دارند:
 *
 * ۱. `screens` **جایگزین** شده، نه گسترش‌یافته. فقط ۶۴۰/۱۰۲۴/۱۴۴۰
 *    وجود دارند و پایه ۳۶۰px است. اگر `md:` را تایپ کنی، کلاس ساخته
 *    نمی‌شود و بلافاصله می‌فهمی — جلوی برگشت ناخودآگاه به ذهنیت دسکتاپ.
 *
 * ۲. مقادیر رنگ به‌صورت کانال HSL بدون `hsl()` ذخیره می‌شوند تا بتوان
 *    با `/` شفافیت داد: `bg-primary/10`.
 */
const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],

  // حالت روشن اجباری در فاز ۱ — حالت تاریک بعداً
  darkMode: 'class',

  theme: {
    screens: {
      sm: '640px',
      lg: '1024px',
      xl: '1440px',
    },

    extend: {
      colors: {
        background: 'hsl(var(--background) / <alpha-value>)',
        foreground: 'hsl(var(--foreground) / <alpha-value>)',
        muted: {
          DEFAULT: 'hsl(var(--muted) / <alpha-value>)',
          foreground: 'hsl(var(--muted-foreground) / <alpha-value>)',
        },
        card: {
          DEFAULT: 'hsl(var(--card) / <alpha-value>)',
          foreground: 'hsl(var(--card-foreground) / <alpha-value>)',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover) / <alpha-value>)',
          foreground: 'hsl(var(--popover-foreground) / <alpha-value>)',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary) / <alpha-value>)',
          foreground: 'hsl(var(--primary-foreground) / <alpha-value>)',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary) / <alpha-value>)',
          foreground: 'hsl(var(--secondary-foreground) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent) / <alpha-value>)',
          foreground: 'hsl(var(--accent-foreground) / <alpha-value>)',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive) / <alpha-value>)',
          foreground: 'hsl(var(--destructive-foreground) / <alpha-value>)',
        },
        border: 'hsl(var(--border) / <alpha-value>)',
        input: 'hsl(var(--input) / <alpha-value>)',
        ring: 'hsl(var(--ring) / <alpha-value>)',
        overlay: 'hsl(var(--overlay) / <alpha-value>)',

        // معنایی دامنه — بدهکار/بستانکار/سود/زیان
        credit: 'hsl(var(--credit) / <alpha-value>)',
        debit: 'hsl(var(--debit) / <alpha-value>)',
        gold: 'hsl(var(--gold) / <alpha-value>)',
      },

      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },

      fontFamily: {
        sans: ['Vazirmatn', 'system-ui', 'sans-serif'],
      },

      spacing: {
        // حداقل هدف لمسی — قاعده‌ی ۶ BOOTSTRAP
        touch: '44px',
        // ارتفاع دکمه‌ی اقدام اصلی
        action: '56px',
      },

      minHeight: {
        touch: '44px',
        action: '56px',
      },
      minWidth: {
        touch: '44px',
      },

      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },

  plugins: [animate],
};

export default config;
