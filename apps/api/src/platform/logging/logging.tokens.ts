/** logger ساختاریافته‌ی pino. با `@Inject(APP_LOGGER) logger: AppLogger` استفاده می‌شود. */
export const APP_LOGGER = Symbol('APP_LOGGER');

/**
 * مقصد خط‌های log. در production خروجی استاندارد است (Docker جمعش می‌کند)؛
 * تست‌ها آن را با یک جریان حافظه‌ای جایگزین می‌کنند تا محتوای log را بررسی کنند.
 */
export const LOG_DESTINATION = Symbol('LOG_DESTINATION');
