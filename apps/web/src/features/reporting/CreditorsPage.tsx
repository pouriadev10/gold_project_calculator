import { PartyBalanceReportPage } from './PartyBalanceReportPage';

/**
 * فهرست بستانکاران — FE-073: اشخاصی که فروشگاه به آن‌ها بدهکار است.
 * منطق مشترک با بدهکاران در `PartyBalanceReportPage`؛ متن‌ها در `REPORT_COPY`.
 */
export default function CreditorsPage() {
  return <PartyBalanceReportPage direction="CREDITOR" />;
}
