import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Controller, Get, Inject, NotFoundException, Param, Res, StreamableFile } from '@nestjs/common';
import { ModulesContainer } from '@nestjs/core';
import getAbsoluteFSPath from 'swagger-ui-dist/absolute-path.js';
import { buildOpenApiDocument } from './openapi-document';
import { routesFromControllers } from './route-discovery';
import type { HeaderWriter } from '../files/pdf-response';
import type { OpenApiDocument } from './openapi-document';
import type { Constructor } from './route-discovery';

/** فقط همین فایل‌های swagger-ui-dist سرو می‌شوند — نه هر نامی که در URL بیاید. */
const ASSETS: Readonly<Record<string, string>> = {
  'swagger-ui.css': 'text/css; charset=utf-8',
  'swagger-ui-bundle.js': 'application/javascript; charset=utf-8',
};

/*
 * مسیرها نسبی‌اند تا پشت پراکسی (`/api/docs`) هم درست باز شوند: پایه‌ی `/api/docs`
 * پوشه‌ی `/api/` است، پس `docs/openapi.json` ← `/api/docs/openapi.json`.
 */
const SWAGGER_HTML = `<!doctype html>
<html lang="fa">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Gold Accounting API</title>
    <link rel="stylesheet" href="docs/assets/swagger-ui.css" />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="docs/assets/swagger-ui-bundle.js"></script>
    <script>
      window.ui = SwaggerUIBundle({ url: 'docs/openapi.json', dom_id: '#swagger-ui', deepLinking: true });
    </script>
  </body>
</html>
`;

/**
 * Swagger UI و مستند OpenAPI — BE-070. فقط بیرون از production ثبت می‌شود
 * (`OpenApiModule`)؛ نسخه‌ی ثابتش در `docs/openapi.json` مخزن است.
 *
 * مستند از کنترلرهای همین برنامه‌ی در حال اجرا ساخته می‌شود، پس همیشه با
 * مسیرهای واقعی هم‌خوان است.
 */
@Controller('docs')
export class OpenApiController {
  #document: OpenApiDocument | undefined;

  constructor(@Inject(ModulesContainer) private readonly modules: ModulesContainer) {}

  @Get()
  page(@Res({ passthrough: true }) reply: HeaderWriter): string {
    reply.header('content-type', 'text/html; charset=utf-8');
    return SWAGGER_HTML;
  }

  @Get('openapi.json')
  document(): OpenApiDocument {
    this.#document ??= buildOpenApiDocument(routesFromControllers(this.controllers()));
    return this.#document;
  }

  @Get('assets/:file')
  async asset(@Param('file') file: string): Promise<StreamableFile> {
    const type = ASSETS[file];
    if (type === undefined) {
      throw new NotFoundException();
    }
    return new StreamableFile(await readFile(join(getAbsoluteFSPath(), file)), { type });
  }

  private controllers(): Constructor[] {
    return [...this.modules.values()].flatMap((module) =>
      [...module.controllers.values()].map((wrapper) => wrapper.metatype as Constructor),
    );
  }
}
