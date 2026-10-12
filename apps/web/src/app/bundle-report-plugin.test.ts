import { describe, expect, it } from 'vitest';
import { classifyModule } from '../../vite-plugins/bundle-report';

/** FE-087 — طبقه‌بندی ماژول‌ها در گزارش ترکیب بسته. */

const STORE = 'C:/repo/node_modules/.pnpm';

describe('classifyModule', () => {
  it('pnpm hashed folder names still resolve to the real package (last node_modules segment)', () => {
    const id = `${STORE}/@radix-ui+react-collection@_e568781db46e6f5e62f713df7975a3a9/node_modules/@radix-ui/react-collection/dist/index.mjs`;
    expect(classifyModule(id).group).toBe('@radix-ui/react-collection');
  });

  it('handles plain and scoped packages, Windows separators and query suffixes', () => {
    expect(classifyModule(`${STORE}/zod@3.25.76/node_modules/zod/lib/index.mjs`).group).toBe('zod');
    expect(classifyModule(String.raw`C:\repo\node_modules\.pnpm\react-dom@18.3.1_react@18.3.1\node_modules\react-dom\index.js`).group).toBe(
      'react-dom',
    );
    expect(classifyModule(`${STORE}/@tanstack+router-core@1.0.0/node_modules/@tanstack/router-core/dist/esm/index.js?v=abc`).group).toBe(
      '@tanstack/router-core',
    );
  });

  it('groups our own code by workspace package and by app area / feature', () => {
    expect(classifyModule('C:/repo/packages/contracts/src/index.ts').group).toBe('@gold/contracts');
    expect(classifyModule('C:/repo/apps/web/src/features/sales/CoinSaleForm.tsx').group).toBe('app:features/sales');
    expect(classifyModule('C:/repo/apps/web/src/components/ui/button.tsx').group).toBe('app:components');
    expect(classifyModule('\0vite/preload-helper.js').group).toBe('other');
  });

  it('reads no version for a package folder it cannot find, instead of guessing', () => {
    expect(classifyModule('/nowhere/node_modules/ghost-pkg/index.js')).toEqual({ group: 'ghost-pkg', packageName: 'ghost-pkg' });
  });
});
