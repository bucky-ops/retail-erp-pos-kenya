/** Shared TypeScript contracts between API routes and frontend. */

export type Tier = "Gold" | "Silver" | "Bronze";
export type PaymentMethod =
  | "Cash"
  | "M-Pesa"
  | "Till"
  | "Paybill"
  | "Gift Card"
  | "Credit Sale"
  | "Card";

export interface StoreDto {
  id: number;
  name: string;
  location: string;
  isMain: boolean;
}

export interface StaffDto {
  id: number;
  name: string;
  role: string;
  color: string;
  onShift: boolean;
  storeId: number | null;
}

export interface CustomerDto {
  id: number;
  name: string;
  phone: string;
  email: string | null;
  tier: Tier;
  loyaltyPoints: number;
  totalSpent: number;
  debtBalance: number;
  creditLimit: number;
  giftCardBalance: number;
  birthday: string | null;
  lastVisit: string | null;
  notes: string | null;
}

export interface ProductDto {
  id: number;
  name: string;
  sku: string;
  barcode: string;
  category: string;
  price: number;
  cost: number;
  unit: string;
  emoji: string;
  stock: { storeId: number; qty: number; reorderPoint: number }[];
}

export interface SaleItemDto {
  id: number;
  productId: number | null;
  name: string;
  emoji: string;
  qty: number;
  unitPrice: number;
  discount: number;
  total: number;
}

export interface SaleDto {
  id: number;
  receiptNo: string;
  storeId: number;
  storeName?: string;
  customerId: number | null;
  customerName?: string | null;
  customerTier?: string | null;
  staffName: string;
  subtotal: number;
  discount: number;
  vat: number;
  total: number;
  paymentMethod: string;
  pointsEarned: number;
  pointsRedeemed: number;
  tierAtSale: string | null;
  promoCode: string | null;
  status: string;
  kraStatus: string;
  cuInvoiceNumber: string | null;
  qrCodeBase64: string | null;
  offlineCreated: boolean;
  createdAt: string;
  items: SaleItemDto[];
}

export interface CartLine {
  productId: number;
  name: string;
  emoji: string;
  sku: string;
  unitPrice: number;
  qty: number;
  category?: string; // used for Happy Hour auto-pricing
}

export interface PaySplit {
  method: string; // Cash | M-Pesa | M-Pesa Till | M-Pesa Paybill | Card | Points | Gift Card
  amount: number;
  ref?: string; // M-Pesa code / gift card code
}

export interface SalePayload {
  clientId?: string; // offline dedupe
  storeId: number;
  customerId: number | null;
  staffName: string;
  items: CartLine[];
  paymentMethod: PaymentMethod;
  promoCode?: string | null;
  pointsRedeemed?: number;
  billDiscount?: number; // flat KES
  offlineCreated?: boolean;
  createdAt?: string;
  paySplits?: PaySplit[]; // multi-pay split (50% M-Pesa + 30% Cash + 20% Points)
  allowPartial?: boolean; // accept underpayment as customer debt
  managerPin?: string; // day-lock override (closed business date)
}

export interface SaleResult {
  ok: boolean;
  sale?: SaleDto;
  loyalty?: { earned: number; balance: number; redeemed: number };
  blocked?: { reason: string; overdueDays: number };
  error?: string;
}

export interface DebtPlanDto {
  id: number;
  customerId: number;
  customerName: string;
  customerPhone: string;
  tier?: string;
  invoiceNo: string | null;
  totalDebt: number;
  installmentType: string;
  installmentAmount: number;
  nextDueDate: string;
  status: string;
  autoReminderSms: boolean;
  autoBlockPosOverdue: boolean;
  overdueDays: number;
}

export interface GiftCardDto {
  id: number;
  code: string;
  balance: number;
  initialBalance: number;
  customerId: number | null;
  customerName?: string | null;
  expiry: string | null;
  status: string;
  gradient: string;
}

export interface ChainDoc {
  no: string;
  digitalCode: string;
  url: string;
  kind: string;
  at: string;
}

export interface DealDto {
  id: string;
  stage: string;
  customerName: string;
  customerPhone: string | null;
  title: string;
  amount: number;
  itemCount: number;
  assignee: string;
  notes: string | null;
  history: { stage: string; at: string; by: string }[];
  docs?: Record<string, ChainDoc>; // matured chain documents
  createdAt: string;
}

export interface PayslipDto {
  id: number;
  employeeId: number;
  employeeName: string;
  idNo: string;
  dept: string;
  role: string;
  period: string;
  basic: number;
  houseAllowance: number;
  transport: number;
  overtime: number;
  gross: number;
  nssf: number;
  shif: number;
  housingLevy: number;
  paye: number;
  helb: number;
  net: number;
  status: string;
  mpesaNumber: string | null;
  bankAccount: string | null;
}

export interface ChatMessageDto {
  id: number;
  channelId: number;
  author: string;
  initials: string;
  content: string;
  docLink: string | null;
  createdAt: string;
}

export interface ChatChannelDto {
  id: number;
  name: string;
  description: string | null;
  unread: number;
  members: number;
}

export interface SmsLogDto {
  id: number;
  customerId: number | null;
  customerName?: string | null;
  phone: string;
  message: string;
  channel: string;
  type: string;
  status: string;
  cost: number;
  createdAt: string;
}

export interface SettingsDto {
  kraPin: string;
  kraBranchId: string;
  kraDeviceSerial: string;
  kraCallbackUrl: string;
  kraConnected: boolean;
  kraLastSync: string | null;
  mpesaEnvironment: "Sandbox" | "Production";
  mpesaConsumerKey: string;
  mpesaConsumerSecret: string;
  mpesaTillNumbers: string;
  mpesaCallbackUrl: string;
  smsApiKey: string;
  smsSenderName: string;
  loyaltyEarnPerKes: number;
  loyaltyPointValue: number;
  loyaltyExpiryMonths: number;
  vatRate: number;
  happyHourEnabled: boolean;
  happyHourStart: string;
  happyHourEnd: string;
  happyHourPercent: number;
  happyHourCategory: string;
  receiptPromoFooter: string;
  receiptPrimaryColor: string;
  receiptSecondaryColor: string;
  companyName: string;
  tierRules: string;
  lastDailyJobsAt: string | null;
  reportScheduleEnabled: boolean;
  reportScheduleFrequency: "Daily" | "Weekly" | "Monthly" | string;
  reportScheduleEmail: string;
  reportScheduleLastSentAt: string | null;
}

export const KES = (n: number, compact = false) => {
  if (compact && Math.abs(n) >= 1000) {
    if (Math.abs(n) >= 1_000_000) return `KES ${(n / 1_000_000).toFixed(1)}M`;
    return `KES ${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k`;
  }
  return `KES ${n.toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;
};
