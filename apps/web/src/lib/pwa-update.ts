/**
 * ثبت سرویس‌ورکر و اعلان نسخه‌ی تازه — FE-090.
 *
 * ثبت همچنان پس از بالا آمدن است (FE-088، `main.tsx`). سرویس‌ورکر در حالت «prompt» است:
 * نسخه‌ی تازه نصب می‌شود و منتظر می‌ماند؛ `onUpdateReady` آن را به رابط کاربری می‌دهد و
 * فقط با تصمیم کاربر (`applyUpdate`) کنترل را می‌گیرد و صفحه یک بار بارگذاری می‌شود.
 *
 * فقط پوسته‌ی برنامه (HTML، JS، CSS، فونت، آیکون) precache می‌شود؛ پاسخ API هرگز کش
 * نمی‌شود و ثبت آفلاین وجود ندارد.
 */

/** هر چند وقت یک‌بار نسخه‌ی تازه بررسی شود — برنامه‌ای که صبح باز و شب بسته می‌شود. */
export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/** پیامی که سرویس‌ورکر Workbox در حالت prompt با آن منتظر ماندن را کنار می‌گذارد. */
export const SKIP_WAITING_MESSAGE = { type: 'SKIP_WAITING' } as const;

export function registerServiceWorker(
  base: string,
  onUpdateReady: (worker: ServiceWorker) => void,
): void {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker
    .register(`${base}sw.js`, { scope: base })
    .then((registration) => watchForUpdates(registration, onUpdateReady))
    .catch(() => {
      // بدون سرویس‌ورکر برنامه همچنان کار می‌کند؛ فقط بازدید بعدی از کش نمی‌آید
    });
}

/**
 * نسخه‌ی منتظر را گزارش می‌کند — هم آنچه پیش از این بارگذاری نصب شده بود، هم آنچه بعداً
 * پیدا شود. نصب **اول** (هنوز هیچ سرویس‌ورکری صفحه را کنترل نمی‌کند) به‌روزرسانی نیست.
 */
export function watchForUpdates(
  registration: ServiceWorkerRegistration,
  onUpdateReady: (worker: ServiceWorker) => void,
): void {
  const report = () => {
    if (registration.waiting && navigator.serviceWorker.controller)
      onUpdateReady(registration.waiting);
  };
  report();
  registration.addEventListener('updatefound', () => {
    const installing = registration.installing;
    installing?.addEventListener('statechange', () => {
      if (installing.state === 'installed') report();
    });
  });

  const check = () => {
    registration.update().catch(() => {
      // آفلاین یا سرور در دسترس نیست — بررسی بعدی دوباره تلاش می‌کند
    });
  };
  setInterval(check, UPDATE_CHECK_INTERVAL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
}

let reloadScheduled = false;

/** نسخه‌ی منتظر را فعال می‌کند و وقتی کنترل را گرفت، صفحه را یک بار بارگذاری می‌کند. */
export function applyUpdate(worker: ServiceWorker): void {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadScheduled) return;
    reloadScheduled = true;
    window.location.reload();
  });
  worker.postMessage(SKIP_WAITING_MESSAGE);
}
