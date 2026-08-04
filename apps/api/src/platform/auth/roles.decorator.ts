import { SetMetadata } from '@nestjs/common';
import type { CustomDecorator } from '@nestjs/common';
import type { RoleCode } from '../database/schema';

export const ROLES_METADATA_KEY = 'gold:roles';

/**
 * نقش‌هایی که اجازه‌ی دسترسی به این مسیر را دارند — BE-012.
 *
 * ```ts
 * @Roles('OWNER', 'MANAGER')
 * ```
 *
 * فهرست **سفید** است، نه حداقلِ سطح: `@Roles('MANAGER')` یعنی فقط مدیر،
 * نه «مدیر و بالاتر». سلسله‌مراتب ضمنی همان چیزی است که روزی صندوق‌دار را
 * بی‌سروصدا به جایی می‌رساند که نباید. اگر مالک هم باید دسترسی داشته
 * باشد، نامش صریح نوشته می‌شود.
 *
 * نبودِ این دکوریتور روی مسیری که `RolesGuard` دارد یعنی «هر عضو این
 * مستأجر»، نه «همه» — احراز هویت و عضویت همچنان الزامی‌اند.
 */
export function Roles(...roles: readonly [RoleCode, ...RoleCode[]]): CustomDecorator<string> {
  return SetMetadata(ROLES_METADATA_KEY, roles);
}
