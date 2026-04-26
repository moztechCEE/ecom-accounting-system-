export type InvoiceMerchantEnvironment = 'stage' | 'production';

export type InvoiceMerchantReadiness = {
  key: string;
  merchantId: string | null;
  entityId: string | null;
  description: string | null;
  env: InvoiceMerchantEnvironment;
  issueUrl: string | null;
  queryUrl: string | null;
  invalidUrl: string | null;
  allowanceUrl: string | null;
  ready: boolean;
  missing: string[];
};

export type InvoiceProviderReadiness = {
  provider: 'ecpay';
  ready: boolean;
  canIssue: boolean;
  message: string;
  requiredEnv: string[];
  accounts: InvoiceMerchantReadiness[];
};

export type IssueInvoicePayload = {
  merchantKey?: string | null;
  merchantId?: string | null;
  relateNumber: string;
  invoiceType: 'B2C' | 'B2B';
  buyerName?: string | null;
  buyerTaxId?: string | null;
  buyerEmail?: string | null;
  buyerPhone?: string | null;
  buyerAddress?: string | null;
  amount: number;
  taxAmount: number;
  totalAmount: number;
  items: Array<{
    name: string;
    quantity: number;
    unitPrice: number;
    amount: number;
    taxAmount?: number;
  }>;
};

export type IssueInvoiceResult = {
  success: boolean;
  provider: 'ecpay';
  merchantKey: string;
  merchantId: string;
  invoiceNumber: string;
  invoiceDate?: string | null;
  randomNumber?: string | null;
  externalInvoiceId?: string | null;
  raw: Record<string, unknown>;
};

export interface InvoiceAdapter {
  getReadiness(): InvoiceProviderReadiness;
  assertReadyForMerchant(merchantKey?: string | null): void;
  issueInvoice(payload: IssueInvoicePayload): Promise<IssueInvoiceResult>;
}
