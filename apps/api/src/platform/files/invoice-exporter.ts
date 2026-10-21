/**
 * Boundary for document rendering. Domain modules may depend on this token
 * and interface, but never on a PDF renderer or its font implementation.
 */
export const INVOICE_EXPORTER = Symbol('INVOICE_EXPORTER');

export type InvoiceSnapshotValue =
  | boolean
  | null
  | string
  | readonly InvoiceSnapshotValue[]
  | { readonly [key: string]: InvoiceSnapshotValue };

export interface InvoiceExportParty {
  readonly displayName: string;
  readonly mobile: string | null;
}

export interface InvoiceExportLine {
  readonly title: string;
  /** Counts, Rial, and weights remain canonical integer strings. */
  readonly quantity: string;
  readonly amountRial: string | null;
}

/** صادرکننده‌ی سند (مستأجر) به‌اضافه‌ی منطقه‌ی زمانی‌اش برای تاریخ‌های چاپی — M-10. */
export interface DocumentIssuer extends InvoiceExportParty {
  readonly timeZone: string;
}

export interface InvoiceExportInput {
  readonly title: string;
  readonly documentNumber: string;
  /**
   * نام فایل بدون پسوند، وقتی سند فاکتور نیست (M-10، #16). پیش‌تر رسید خرید و صورت‌حساب هم
   * `invoice-<uuid>.pdf` نام می‌گرفتند. نبودنش یعنی `invoice-<documentNumber>`.
   */
  readonly fileNameStem?: string;
  readonly issuedAt: Date;
  /** تاریخ‌های چاپی در منطقه‌ی زمانی مستأجر (`tenants.timezone`)، نه یک تهران ِ ثابت. */
  readonly issuer: DocumentIssuer;
  readonly recipient: InvoiceExportParty;
  readonly lockedQuote:
    | {
    readonly amountRial: string;
    readonly observedAt: Date;
      }
    | null;
  readonly lines: readonly InvoiceExportLine[];
  readonly historicalSnapshot: InvoiceSnapshotValue;
}

export interface ExportedFile {
  readonly fileName: string;
  readonly contentType: 'application/pdf';
  readonly content: Buffer;
}

export interface InvoiceExporter {
  exportInvoice(input: InvoiceExportInput): Promise<ExportedFile>;
}
