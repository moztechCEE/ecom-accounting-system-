import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createCipheriv, createDecipheriv } from 'crypto';
import {
  InvoiceAdapter,
  IssueInvoicePayload,
  IssueInvoiceResult,
} from '../interfaces/invoice-adapter.interface';
import {
  EcpayEinvoiceConfigService,
  EcpayEinvoiceProfile,
} from '../services/ecpay-einvoice-config.service';

@Injectable()
export class EcpayEinvoiceAdapter implements InvoiceAdapter {
  constructor(private readonly configService: EcpayEinvoiceConfigService) {}

  getReadiness() {
    return this.configService.getReadiness();
  }

  assertReadyForMerchant(merchantKey?: string | null) {
    const profile = this.configService.resolveProfile(merchantKey);
    if (!profile) {
      throw new BadRequestException(
        merchantKey
          ? `找不到綠界電子發票帳號設定：${merchantKey}。請檢查 ECPAY_EINVOICE_ACCOUNTS_JSON。`
          : '請先指定可用的綠界電子發票 merchantKey；目前未能唯一判斷要使用 3290494 或 3150241。',
      );
    }

    const missing = this.configService.getProfileMissingFields(profile);
    if (missing.length > 0) {
      throw new BadRequestException(
        `綠界電子發票帳號 ${profile.key || profile.merchantId} 尚未可正式開票，缺少：${missing.join(
          ', ',
        )}。請補 ECPAY_EINVOICE_ACCOUNTS_JSON。`,
      );
    }
  }

  async issueInvoice(
    payload: IssueInvoicePayload,
  ): Promise<IssueInvoiceResult> {
    const profile = this.configService.resolveProfile(
      payload.merchantKey,
      payload.merchantId,
    );
    if (!profile) {
      throw new BadRequestException(
        '找不到可用的綠界電子發票 merchant profile。',
      );
    }

    this.assertReadyForMerchant(profile.key);

    const ecpayPayload = this.toEcpayB2cIssuePayload(payload, profile);
    const json = await this.postEncrypted(
      profile.issueUrl,
      ecpayPayload,
      profile,
    );
    const result = this.decryptResponse(json, profile);

    if (Number(result?.RtnCode) !== 1) {
      throw new ServiceUnavailableException(
        String(result?.RtnMsg || json?.TransMsg || '綠界電子發票開立未成功。'),
      );
    }

    if (!result?.InvoiceNo) {
      throw new ServiceUnavailableException(
        '綠界電子發票開立回應缺少 InvoiceNo，已阻擋本地寫入避免產生錯誤發票狀態。',
      );
    }

    return {
      success: true,
      provider: 'ecpay',
      merchantKey: profile.key,
      merchantId: profile.merchantId,
      invoiceNumber: String(result?.InvoiceNo || ''),
      invoiceDate:
        typeof result?.InvoiceDate === 'string' ? result.InvoiceDate : null,
      randomNumber:
        typeof result?.RandomNumber === 'string' ? result.RandomNumber : null,
      externalInvoiceId:
        typeof result?.InvoiceNo === 'string' ? result.InvoiceNo : null,
      raw: result as Record<string, unknown>,
    };
  }

  private toEcpayB2cIssuePayload(
    payload: IssueInvoicePayload,
    profile: EcpayEinvoiceProfile,
  ) {
    if (!payload.buyerEmail && !payload.buyerPhone) {
      throw new BadRequestException(
        '綠界電子發票開立至少需要買方 email 或手機號碼。',
      );
    }

    if (payload.invoiceType === 'B2B' && !payload.buyerTaxId) {
      throw new BadRequestException('B2B 發票需提供買方統一編號。');
    }

    const items = payload.items.map((item, index) => ({
      ItemSeq: index + 1,
      ItemName: item.name || '商品',
      ItemCount: Math.max(Number(item.quantity || 1), 1),
      ItemWord: '件',
      ItemPrice: Math.round(Number(item.unitPrice || item.amount || 0)),
      ItemTaxType: '1',
      ItemAmount: Math.round(Number(item.amount || 0)),
      ItemRemark: '',
    }));

    return {
      MerchantID: profile.merchantId,
      RelateNumber: payload.relateNumber,
      CustomerName: payload.buyerName || '',
      CustomerAddr: payload.buyerAddress || '',
      CustomerPhone: payload.buyerPhone || '',
      CustomerEmail: payload.buyerEmail || '',
      CustomerIdentifier:
        payload.invoiceType === 'B2B' ? payload.buyerTaxId || '' : '',
      Print: payload.invoiceType === 'B2B' ? '1' : '0',
      Donation: '0',
      LoveCode: '',
      CarrierType: '',
      CarrierNum: '',
      TaxType: '1',
      SalesAmount: Math.round(payload.totalAmount),
      InvoiceRemark: '',
      InvType: '07',
      vat: '1',
      Items: items,
    };
  }

  private async postEncrypted(
    url: string,
    payload: Record<string, unknown>,
    profile: EcpayEinvoiceProfile,
  ) {
    const body = {
      MerchantID: profile.merchantId,
      RqHeader: {
        Timestamp: Math.floor(Date.now() / 1000),
      },
      Data: this.encryptPayload(payload, profile),
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const json = await response.json();

    if (!response.ok) {
      throw new ServiceUnavailableException(
        `綠界電子發票 API 呼叫失敗 (${response.status})`,
      );
    }

    if (Number(json?.TransCode) !== 1 || !json?.Data) {
      throw new ServiceUnavailableException(
        json?.TransMsg || '綠界電子發票 API 未成功受理。',
      );
    }

    return json;
  }

  private encryptPayload(
    payload: Record<string, unknown>,
    profile: EcpayEinvoiceProfile,
  ) {
    const encoded = encodeURIComponent(JSON.stringify(payload));
    const cipher = createCipheriv(
      'aes-128-cbc',
      Buffer.from(profile.hashKey, 'utf8'),
      Buffer.from(profile.hashIv, 'utf8'),
    );
    let encrypted = cipher.update(encoded, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    return encrypted;
  }

  private decryptResponse(json: any, profile: EcpayEinvoiceProfile) {
    const decipher = createDecipheriv(
      'aes-128-cbc',
      Buffer.from(profile.hashKey, 'utf8'),
      Buffer.from(profile.hashIv, 'utf8'),
    );
    let decrypted = decipher.update(json.Data, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    const decoded = decodeURIComponent(decrypted);
    return decoded.trim() ? JSON.parse(decoded) : {};
  }
}
