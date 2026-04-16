import { Decimal } from '@prisma/client/runtime/library';

export type UnifiedTransactionFeeStatus =
  | 'actual'
  | 'estimated'
  | 'unavailable'
  | 'not_applicable';

export interface UnifiedOrder {
  externalId: string;
  orderDate: Date;
  status: 'pending' | 'completed' | 'cancelled' | 'refunded';
  customer?: {
    externalId?: string;
    email?: string;
    name?: string;
    phone?: string;
  };
  items: UnifiedOrderItem[];
  totals: UnifiedOrderTotals;
  raw: any; // Original payload for debugging
}

export interface UnifiedOrderItem {
  sku: string;
  productName: string;
  quantity: number;
  unitPrice: Decimal;
  discount: Decimal;
  tax: Decimal;
  total: Decimal;
}

export interface UnifiedOrderTotals {
  currency: string;
  gross: Decimal; // Total including tax, shipping, before discount? Or Final total customer pays? Usually Gross = Items + Shipping - Discount + Tax
  tax: Decimal;
  discount: Decimal;
  shipping: Decimal;
  net: Decimal; // Usually Gross, but sometimes used for Payout Net
}

export interface UnifiedTransaction {
  externalId: string;
  orderId?: string; // External Order ID
  payoutId?: string;
  date: Date;
  type: 'sale' | 'refund' | 'payout';
  amount: Decimal;
  fee: Decimal; // Platform fee
  net: Decimal; // Amount - Fee
  currency: string;
  status: 'pending' | 'success' | 'failed';
  gateway?: string;
  feeStatus?: UnifiedTransactionFeeStatus;
  feeSource?: string;
  raw: any;
}

export interface ISalesChannelAdapter {
  /**
   * Unique code for the channel (e.g. SHOPIFY, MOMO)
   */
  readonly code: string;

  /**
   * Test if API credentials are valid
   */
  testConnection(): Promise<{ success: boolean; message?: string }>;

  /**
   * Fetch orders within a date range and normalize them
   */
  fetchOrders(params: { start: Date; end: Date }): Promise<UnifiedOrder[]>;

  /**
   * Fetch financial transactions (payments/payouts)
   */
  fetchTransactions(params: {
    start: Date;
    end: Date;
  }): Promise<UnifiedTransaction[]>;
}
