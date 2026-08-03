# syntax=docker/dockerfile:1
#
# ایمیج بک‌اند. context این Dockerfile **ریشه‌ی مخزن** است، نه apps/api —
# چون بیلد به pnpm-lock.yaml و packages/contracts هم نیاز دارد.
#
#   docker build -f apps/api/Dockerfile .

ARG NODE_VERSION=22
ARG PNPM_VERSION=11.18.0

# ── پایه: pnpm روی Node ۲۲ ─────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine AS base
ARG PNPM_VERSION
# با PNPM_HOME، خودِ pnpm انبارش را در $PNPM_HOME/store می‌گذارد و
# cache mountهای پایین می‌توانند بینِ بیلدها نگهش دارند.
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /repo

# ── اسکلت workspace ────────────────────────────────────────────────
# فقط فایل‌های تعریف پکیج. هر تغییری در کد منبع این لایه را باطل نمی‌کند،
# پس نصب وابستگی‌ها فقط وقتی دوباره اجرا می‌شود که واقعاً چیزی عوض شده باشد.
#
# package.json هر چهار پکیج لازم است: `--frozen-lockfile` قفل را با کل
# workspace مقایسه می‌کند و نبودِ حتی apps/web باعث می‌شود نصب رد شود.
FROM base AS skeleton
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
COPY packages/core-calc/package.json packages/core-calc/

# ── وابستگی‌های کامل (برای بیلد) ────────────────────────────────────
# «@gold/api...» یعنی خود api به‌علاوه‌ی وابستگی‌هایش. apps/web و ابزار
# فرانت‌اند اصلاً نصب نمی‌شوند.
FROM skeleton AS deps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter "@gold/api..."

# ── بیلد ───────────────────────────────────────────────────────────
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/contracts packages/contracts
COPY apps/api apps/api
# ترتیب توپولوژیک pnpm اول contracts را می‌سازد، بعد api —
# چون runtime بک‌اند CommonJS است و از dist پکیج قرارداد می‌خواند.
RUN pnpm --filter "@gold/api..." build

# ── وابستگی‌های production ─────────────────────────────────────────
FROM skeleton AS prod-deps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter "@gold/api..."

# ── اجرا ───────────────────────────────────────────────────────────
# از node خام شروع می‌شود نه از base: pnpm و corepack در زمان اجرا
# لازم نیستند و فقط سطح حمله را بزرگ می‌کنند.
FROM node:${NODE_VERSION}-alpine AS runtime

ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /repo

# ساختار پوشه‌ها باید عیناً حفظ شود: پیوندهای نمادین pnpm نسبی‌اند
# (apps/api/node_modules/@gold/contracts → ../../packages/contracts).
COPY --from=prod-deps /repo/node_modules ./node_modules
COPY --from=prod-deps /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=prod-deps /repo/packages/contracts/node_modules ./packages/contracts/node_modules

COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/packages/contracts/dist ./packages/contracts/dist

# package.json‌ها در زمان اجرا هم لازم‌اند: شرط `require` در فیلد exports
# پکیج قرارداد از همین‌جا خوانده می‌شود.
COPY apps/api/package.json ./apps/api/
COPY packages/contracts/package.json ./packages/contracts/
COPY apps/api/scripts ./apps/api/scripts
# فایل‌های مهاجرت SQL — سرویس migrate در docker-compose.yml همین‌ها را
# می‌خواند. بدون این COPY، migrate.mjs با «meta/_journal.json پیدا نشد»
# شکست می‌خورد چون drizzle/ اصلاً داخل ایمیج نیست.
COPY apps/api/drizzle ./apps/api/drizzle

USER node
EXPOSE 3000

CMD ["node", "apps/api/dist/main.js"]
