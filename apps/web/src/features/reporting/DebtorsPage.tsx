import { PartyBalanceReportPage } from './PartyBalanceReportPage';

/** فهرست بدهکاران — FE-072. منطق مشترک با بستانکاران در `PartyBalanceReportPage`. */
export default function DebtorsPage() {
  return <PartyBalanceReportPage direction="DEBTOR" />;
}
