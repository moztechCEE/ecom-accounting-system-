import api from "./api";
import type { EvidenceFile } from "./expense.service";

export interface ReceiptRecognition {
  status: "needs_confirmation";
  modelId: string;
  recognizedAt: string;
  fingerprints: string[];
  confidence: number;
  warnings: string[];
  possibleDuplicate: boolean;
  fields: {
    supplierName: string | null;
    description: string | null;
    amountOriginal: number | null;
    currency: string | null;
    taxAmount: number | null;
    expenseDate: string | null;
    invoiceNo: string | null;
    sellerTaxId: string | null;
    buyerTaxId: string | null;
    receiptType: string | null;
    suggestedItemId: string | null;
  };
}

export const receiptRecognitionService = {
  async recognize(entityId: string, files: EvidenceFile[], modelId?: string) {
    const { data } = await api.post<ReceiptRecognition>(
      "/expense/receipts/recognize",
      { entityId, files, modelId },
      { timeout: 55_000 },
    );
    return data;
  },
};

export function readReceiptFile(file: File): Promise<EvidenceFile> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve({
        name: file.name,
        mimeType: file.type,
        url: reader.result as string,
      });
    reader.onerror = () => reject(new Error("無法讀取憑證檔案"));
    reader.readAsDataURL(file);
  });
}
