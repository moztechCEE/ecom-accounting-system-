import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * 報表服務
 *
 * 核心功能：
 * 1. 財務報表（損益表、資產負債表、現金流量表、權益變動表）
 * 2. 管理報表（銷售分析、成本分析、費用分析）
 * 3. 自訂報表
 * 4. 報表匯出（Excel, PDF）
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async getDashboardSalesOverview(
    entityId: string,
    startDate?: Date,
    endDate?: Date,
  ) {
    const stores = this.getOneShopStores();
    const buckets = this.buildDashboardBuckets(stores);

    const bucketMap = new Map(
      buckets.map((bucket) => [
        bucket.key,
        {
          ...bucket,
          gross: 0,
          orderCount: 0,
          payoutGross: 0,
          payoutNet: 0,
          feeTotal: 0,
          paymentCount: 0,
          reconciledCount: 0,
          pendingPayoutCount: 0,
        },
      ]),
    );

    const orderDateFilter = this.buildDateFilter(startDate, endDate);
    const paymentDateFilter = this.buildDateFilter(startDate, endDate);

    const [orders, payments] = await Promise.all([
      this.prisma.salesOrder.findMany({
        where: {
          entityId,
          ...(orderDateFilter ? { orderDate: orderDateFilter } : {}),
        },
        select: {
          id: true,
          notes: true,
          totalGrossOriginal: true,
          channel: {
            select: {
              code: true,
              name: true,
            },
          },
        },
      }),
      this.prisma.payment.findMany({
        where: {
          entityId,
          ...(paymentDateFilter ? { payoutDate: paymentDateFilter } : {}),
        },
        select: {
          id: true,
          channel: true,
          notes: true,
          amountGrossOriginal: true,
          amountNetOriginal: true,
          feePlatformOriginal: true,
          feeGatewayOriginal: true,
          reconciledFlag: true,
          salesOrder: {
            select: {
              notes: true,
              channel: {
                select: {
                  code: true,
                },
              },
            },
          },
        },
      }),
    ]);

    for (const order of orders) {
      const bucketKey = this.resolvePerformanceBucket({
        channelCode: order.channel?.code,
        notes: order.notes,
        stores,
      });
      const bucket = bucketMap.get(bucketKey) || bucketMap.get('other');
      if (!bucket) {
        continue;
      }
      bucket.gross += Number(order.totalGrossOriginal || 0);
      bucket.orderCount += 1;
    }

    for (const payment of payments) {
      const bucketKey = this.resolvePerformanceBucket({
        channelCode: payment.salesOrder?.channel?.code || payment.channel,
        notes: payment.salesOrder?.notes || payment.notes,
        fallbackNotes: payment.notes,
        stores,
      });
      const bucket = bucketMap.get(bucketKey) || bucketMap.get('other');
      if (!bucket) {
        continue;
      }

      bucket.payoutGross += Number(payment.amountGrossOriginal || 0);
      bucket.payoutNet += Number(payment.amountNetOriginal || 0);
      bucket.feeTotal +=
        Number(payment.feePlatformOriginal || 0) +
        Number(payment.feeGatewayOriginal || 0);
      bucket.paymentCount += 1;
      if (payment.reconciledFlag) {
        bucket.reconciledCount += 1;
      } else {
        bucket.pendingPayoutCount += 1;
      }
    }

    const bucketItems = Array.from(bucketMap.values());
    const total = bucketItems.reduce(
      (acc, bucket) => ({
        key: 'total',
        label: '總業績',
        gross: acc.gross + bucket.gross,
        orderCount: acc.orderCount + bucket.orderCount,
        payoutGross: acc.payoutGross + bucket.payoutGross,
        payoutNet: acc.payoutNet + bucket.payoutNet,
        feeTotal: acc.feeTotal + bucket.feeTotal,
        paymentCount: acc.paymentCount + bucket.paymentCount,
        reconciledCount: acc.reconciledCount + bucket.reconciledCount,
        pendingPayoutCount: acc.pendingPayoutCount + bucket.pendingPayoutCount,
      }),
      {
        key: 'total',
        label: '總業績',
        gross: 0,
        orderCount: 0,
        payoutGross: 0,
        payoutNet: 0,
        feeTotal: 0,
        paymentCount: 0,
        reconciledCount: 0,
        pendingPayoutCount: 0,
      },
    );

    return {
      entityId,
      range: {
        startDate: startDate?.toISOString() || null,
        endDate: endDate?.toISOString() || null,
      },
      buckets: bucketItems,
      total,
    };
  }

  async getDashboardExecutiveOverview(
    entityId: string,
    startDate?: Date,
    endDate?: Date,
  ) {
    const orderDateFilter = this.buildDateFilter(startDate, endDate);
    const expenseDateFilter = this.buildDateFilter(startDate, endDate);
    const inventoryAlertThreshold = Number(
      this.configService.get<string>('DASHBOARD_INVENTORY_ALERT_THRESHOLD', '5'),
    );
    const payoutOverdueDays = Number(
      this.configService.get<string>('DASHBOARD_PAYOUT_OVERDUE_DAYS', '3'),
    );
    const anomalyWindowStart = new Date();
    anomalyWindowStart.setDate(anomalyWindowStart.getDate() - 14);
    const overduePayoutDate = new Date();
    overduePayoutDate.setDate(overduePayoutDate.getDate() - payoutOverdueDays);

    const [
      expenseAgg,
      fallbackPaidExpenseAgg,
      pendingExpenseAgg,
      approvedExpenseAgg,
      pendingPayoutCount,
      overduePendingPayoutAgg,
      feeBackfillAgg,
      missingPayoutJournalAgg,
      unmatchedPayoutLineAgg,
      uninvoicedOrdersAgg,
      uninvoicedOrdersCount,
      inventorySnapshots,
    ] = await Promise.all([
      this.prisma.expense.aggregate({
        where: {
          entityId,
          ...(expenseDateFilter ? { expenseDate: expenseDateFilter } : {}),
        },
        _sum: {
          totalAmountOriginal: true,
        },
        _count: {
          id: true,
        },
      }),
      this.prisma.expenseRequest.aggregate({
        where: {
          entityId,
          paymentStatus: 'paid',
          ...(expenseDateFilter ? { updatedAt: expenseDateFilter } : {}),
        },
        _sum: {
          amountOriginal: true,
        },
        _count: {
          id: true,
        },
      }),
      this.prisma.expenseRequest.aggregate({
        where: {
          entityId,
          status: 'pending',
          ...(expenseDateFilter ? { createdAt: expenseDateFilter } : {}),
        },
        _sum: {
          amountOriginal: true,
        },
        _count: {
          id: true,
        },
      }),
      this.prisma.expenseRequest.aggregate({
        where: {
          entityId,
          status: 'approved',
          paymentStatus: {
            not: 'paid',
          },
          ...(expenseDateFilter ? { approvedAt: expenseDateFilter } : {}),
        },
        _sum: {
          amountOriginal: true,
        },
        _count: {
          id: true,
        },
      }),
      this.prisma.payment.count({
        where: {
          entityId,
          reconciledFlag: false,
          status: {
            in: ['completed', 'success', 'pending'],
          },
        },
      }),
      this.prisma.payment.aggregate({
        where: {
          entityId,
          reconciledFlag: false,
          status: {
            in: ['completed', 'success'],
          },
          payoutDate: {
            lte: overduePayoutDate,
          },
        },
        _count: {
          id: true,
        },
        _sum: {
          amountNetOriginal: true,
        },
      }),
      this.prisma.payment.aggregate({
        where: {
          entityId,
          status: {
            in: ['completed', 'success'],
          },
          OR: [
            {
              notes: null,
            },
            {
              notes: {
                not: {
                  contains: 'feeStatus=actual',
                },
              },
            },
          ],
        },
        _count: {
          id: true,
        },
        _sum: {
          amountGrossOriginal: true,
        },
      }),
      this.prisma.payment.aggregate({
        where: {
          entityId,
          reconciledFlag: true,
          OR: [
            {
              notes: null,
            },
            {
              notes: {
                not: {
                  contains: 'journalEntryId=',
                },
              },
            },
          ],
        },
        _count: {
          id: true,
        },
        _sum: {
          amountNetOriginal: true,
        },
      }),
      this.prisma.payoutImportLine.aggregate({
        where: {
          batch: {
            entityId,
          },
          status: {
            in: ['unmatched', 'invalid'],
          },
          createdAt: {
            gte: anomalyWindowStart,
          },
        },
        _count: {
          id: true,
        },
        _sum: {
          netAmountOriginal: true,
        },
      }),
      this.prisma.salesOrder.aggregate({
        where: {
          entityId,
          hasInvoice: false,
          status: {
            notIn: ['cancelled', 'refunded'],
          },
          ...(orderDateFilter ? { orderDate: orderDateFilter } : {}),
        },
        _count: {
          id: true,
        },
        _sum: {
          totalGrossOriginal: true,
        },
      }),
      this.prisma.salesOrder.count({
        where: {
          entityId,
          hasInvoice: false,
          status: {
            notIn: ['cancelled', 'refunded'],
          },
          ...(orderDateFilter ? { orderDate: orderDateFilter } : {}),
        },
      }),
      this.prisma.inventorySnapshot.findMany({
        where: {
          entityId,
        },
        select: {
          productId: true,
          qtyAvailable: true,
          qtyOnHand: true,
          product: {
            select: {
              sku: true,
              name: true,
            },
          },
        },
      }),
    ]);

    const actualSpend =
      Number(expenseAgg._sum.totalAmountOriginal || 0) ||
      Number(fallbackPaidExpenseAgg._sum.amountOriginal || 0);
    const actualSpendCount =
      Number(expenseAgg._count.id || 0) ||
      Number(fallbackPaidExpenseAgg._count.id || 0);
    const pendingExpenseAmount = Number(pendingExpenseAgg._sum.amountOriginal || 0);
    const pendingExpenseCount = Number(pendingExpenseAgg._count.id || 0);
    const approvedExpenseAmount = Number(
      approvedExpenseAgg._sum.amountOriginal || 0,
    );
    const approvedExpenseCount = Number(approvedExpenseAgg._count.id || 0);
    const overduePendingPayoutCount = Number(
      overduePendingPayoutAgg._count.id || 0,
    );
    const overduePendingPayoutAmount = Number(
      overduePendingPayoutAgg._sum.amountNetOriginal || 0,
    );
    const feeBackfillCount = Number(feeBackfillAgg._count.id || 0);
    const feeBackfillAmount = Number(feeBackfillAgg._sum.amountGrossOriginal || 0);
    const missingPayoutJournalCount = Number(
      missingPayoutJournalAgg._count.id || 0,
    );
    const missingPayoutJournalAmount = Number(
      missingPayoutJournalAgg._sum.amountNetOriginal || 0,
    );
    const unmatchedPayoutLineCount = Number(
      unmatchedPayoutLineAgg._count.id || 0,
    );
    const unmatchedPayoutLineAmount = Number(
      unmatchedPayoutLineAgg._sum.netAmountOriginal || 0,
    );
    const uninvoicedOrdersAmount = Number(
      uninvoicedOrdersAgg._sum.totalGrossOriginal || 0,
    );

    const inventoryByProduct = new Map<
      string,
      { sku: string; name: string; qtyAvailable: number; qtyOnHand: number }
    >();

    for (const snapshot of inventorySnapshots) {
      const current = inventoryByProduct.get(snapshot.productId) || {
        sku: snapshot.product.sku,
        name: snapshot.product.name,
        qtyAvailable: 0,
        qtyOnHand: 0,
      };

      current.qtyAvailable += Number(snapshot.qtyAvailable || 0);
      current.qtyOnHand += Number(snapshot.qtyOnHand || 0);
      inventoryByProduct.set(snapshot.productId, current);
    }

    const inventoryRows = Array.from(inventoryByProduct.values());
    const outOfStockItems = inventoryRows.filter((item) => item.qtyAvailable <= 0);
    const lowStockItems = inventoryRows
      .filter(
        (item) =>
          item.qtyAvailable > 0 && item.qtyAvailable <= inventoryAlertThreshold,
      )
      .sort((a, b) => a.qtyAvailable - b.qtyAvailable);

    const topAlerts = [...outOfStockItems, ...lowStockItems].slice(0, 6);
    const anomalies = [
      {
        key: 'overdue-payouts',
        title: '已付款但超過時限仍未撥款',
        count: overduePendingPayoutCount,
        amount: overduePendingPayoutAmount,
        tone: overduePendingPayoutCount > 0 ? 'critical' : 'healthy',
        helper: `消費者已付款，但超過 ${payoutOverdueDays} 天仍未看到綠界或平台撥款，先檢查 1191 應收帳款是否應轉入 1113 銀行存款。`,
        accountCode: '1191 / 1113',
        accountName: '應收帳款 / 銀行存款',
        statusLabel: '待追撥款',
      },
      {
        key: 'pending-fee-backfill',
        title: '待補實際手續費與處理費',
        count: feeBackfillCount,
        amount: feeBackfillAmount,
        tone: feeBackfillCount > 0 ? 'warning' : 'healthy',
        helper:
          '這些收款還在用預估或空白費率，請匯入綠界報表回填 6131 佣金支出與 6134 其他營業費用。',
        accountCode: '6131 / 6134',
        accountName: '佣金支出 / 其他營業費用',
        statusLabel: '待補費率',
      },
      {
        key: 'missing-payout-journal',
        title: '已對帳但尚未產生撥款分錄',
        count: missingPayoutJournalCount,
        amount: missingPayoutJournalAmount,
        tone: missingPayoutJournalCount > 0 ? 'warning' : 'healthy',
        helper:
          '這些收款已完成對帳，但尚未在會計分錄留下 journalEntryId，需確認 1113 / 1191 / 6131 / 6134 是否已完整入帳。',
        accountCode: '1113 / 1191 / 6131 / 6134',
        accountName: '銀行存款 / 應收帳款 / 佣金支出 / 其他營業費用',
        statusLabel: '待落帳',
      },
      {
        key: 'unmatched-provider-lines',
        title: '綠界匯入列未自動匹配',
        count: unmatchedPayoutLineCount,
        amount: unmatchedPayoutLineAmount,
        tone: unmatchedPayoutLineCount > 0 ? 'attention' : 'healthy',
        helper:
          '最近 14 天的撥款匯入仍有未匹配或格式異常列，代表入帳金額尚未完整回到收款與對帳鏈。',
        accountCode: '1113 / 1191',
        accountName: '銀行存款 / 應收帳款',
        statusLabel: '待人工核對',
      },
      {
        key: 'uninvoiced-orders',
        title: '成交訂單尚未開立發票',
        count: uninvoicedOrdersCount,
        amount: uninvoicedOrdersAmount,
        tone: uninvoicedOrdersCount > 0 ? 'attention' : 'healthy',
        helper:
          '這些訂單已成交但還沒完成發票流程，需同步確認 4111 銷貨收入與 2194 應付營業稅。',
        accountCode: '4111 / 2194',
        accountName: '銷貨收入 / 應付營業稅',
        statusLabel: '待開票',
      },
      {
        key: 'inventory-alerts',
        title: '低庫存或缺貨商品',
        count: topAlerts.length,
        amount: null,
        tone: topAlerts.length > 0 ? 'critical' : 'healthy',
        helper:
          '庫存不足會直接影響成交與交付，先處理缺貨品項與安全庫存調整。',
        accountCode: null,
        accountName: null,
        statusLabel: '待補貨',
      },
    ].filter((item) => item.count > 0);
    const reconciliationRules = [
      {
        key: 'order-revenue-recognition',
        title: '訂單成立與發票檢核',
        status: uninvoicedOrdersCount > 0 ? 'monitoring' : 'active',
        metric: uninvoicedOrdersCount,
        description:
          '所有 Shopify、1Shop、Shopline 訂單先統一映射為同一筆營收事件，並檢查是否已開立發票。',
        accountingEntry:
          '借：1191 應收帳款；貸：4111 銷貨收入、2194 應付營業稅',
        helper:
          '先確認訂單主檔、付款方式與開票狀態一致，避免業績已入帳但稅務與發票未閉環。',
      },
      {
        key: 'provider-payout-reconciliation',
        title: '綠界撥款與應收帳款沖銷',
        status:
          overduePendingPayoutCount > 0 || unmatchedPayoutLineCount > 0
            ? 'monitoring'
            : 'active',
        metric: overduePendingPayoutCount + unmatchedPayoutLineCount,
        description:
          '用綠界匯出 Excel 的撥款狀態、每筆手續費、處理費與平台費，自動回填 Payment 並核對是否真的入帳。',
        accountingEntry:
          '借：1113 銀行存款、6131 佣金支出、6134 其他營業費用；貸：1191 應收帳款',
        helper:
          '只要匯入列匹配成功，就把實際淨額與費用拆分寫回，取代原本預估手續費。',
      },
      {
        key: 'fee-backfill-governance',
        title: '實際費率回填與差額監控',
        status: feeBackfillCount > 0 ? 'monitoring' : 'active',
        metric: feeBackfillCount,
        description:
          '若交易已完成但尚未回填 provider payout，系統會將其列入待補費率名單，避免毛利與淨額失真。',
        accountingEntry:
          '借：6131 / 6134；貸：1191',
        helper:
          '綠界匯出中的交易手續費、處理費與平台手續費會個別保存，讓管理層可追蹤真實抽成結構。',
      },
      {
        key: 'payment-to-payout-lifecycle',
        title: '付款、物流、撥款三段式狀態機',
        status: pendingPayoutCount > 0 ? 'monitoring' : 'active',
        metric: pendingPayoutCount,
        description:
          '系統把待付款、已付款、待撥款、已撥款、已對帳拆開來看，方便辨識貨到付款或超商未取造成的落差。',
        accountingEntry:
          '先留在 1191 應收帳款，實際撥款後才轉入 1113 銀行存款',
        helper:
          '這條規則會持續用在 1Shop、Shopify、Shopline 與綠界串接，確保不同通路可用同一套標準追帳。',
      },
    ];
    const openAnomalyCount = anomalies.reduce(
      (sum, item) => sum + item.count,
      0,
    );

    return {
      entityId,
      range: {
        startDate: startDate?.toISOString() || null,
        endDate: endDate?.toISOString() || null,
      },
      expenses: {
        actualSpend,
        actualSpendCount,
        pendingApprovalAmount: pendingExpenseAmount,
        pendingApprovalCount: pendingExpenseCount,
        approvedUnpaidAmount: approvedExpenseAmount,
        approvedUnpaidCount: approvedExpenseCount,
      },
      operations: {
        pendingPayoutCount,
        overduePendingPayoutCount,
        feeBackfillCount,
        missingPayoutJournalCount,
        unmatchedPayoutLineCount,
        uninvoicedOrdersCount,
        inventoryAlertCount: topAlerts.length,
        outOfStockCount: outOfStockItems.length,
        openAnomalyCount,
      },
      inventoryAlerts: topAlerts.map((item) => ({
        sku: item.sku,
        name: item.name,
        qtyAvailable: item.qtyAvailable,
        qtyOnHand: item.qtyOnHand,
        severity: item.qtyAvailable <= 0 ? 'critical' : 'warning',
      })),
      anomalies,
      reconciliationRules,
      tasks: [
        {
          key: 'pending-payout',
          title: '待撥款與待對帳款項',
          value: pendingPayoutCount,
          amount: null,
          tone: pendingPayoutCount > 0 ? 'warning' : 'healthy',
          helper: '消費者可能已付款，但金流尚未正式撥款或未回填對帳結果。',
        },
        {
          key: 'missing-payout-journal',
          title: '已對帳未落帳',
          value: missingPayoutJournalCount,
          amount: missingPayoutJournalAmount,
          tone: missingPayoutJournalCount > 0 ? 'attention' : 'healthy',
          helper: '對帳完成後應自動建立撥款分錄，這裡追蹤仍待補落帳的資料。',
        },
        {
          key: 'pending-expense-approval',
          title: '待審核費用申請',
          value: pendingExpenseCount,
          amount: pendingExpenseAmount,
          tone: pendingExpenseCount > 0 ? 'warning' : 'healthy',
          helper: '有待主管或財務核准的支出，會影響當期費用掌握。',
        },
        {
          key: 'approved-expense-payment',
          title: '已核准但尚未付款',
          value: approvedExpenseCount,
          amount: approvedExpenseAmount,
          tone: approvedExpenseCount > 0 ? 'attention' : 'healthy',
          helper: '這些費用已核准，但尚未真正出款。',
        },
        {
          key: 'uninvoiced-orders',
          title: '待開立發票訂單',
          value: uninvoicedOrdersCount,
          amount: null,
          tone: uninvoicedOrdersCount > 0 ? 'attention' : 'healthy',
          helper: '已成交訂單但尚未完成發票流程，會影響帳務完整性。',
        },
        {
          key: 'inventory-alerts',
          title: '庫存警示商品',
          value: topAlerts.length,
          amount: null,
          tone: topAlerts.length > 0 ? 'critical' : 'healthy',
          helper: '低庫存或缺貨商品需要優先追補，避免影響銷售。',
        },
      ],
    };
  }

  async getDashboardReconciliationFeed(
    entityId: string,
    startDate?: Date,
    endDate?: Date,
    limit = 12,
  ) {
    const stores = this.getOneShopStores();
    const buckets = this.buildDashboardBuckets(stores);
    const bucketMap = new Map(buckets.map((bucket) => [bucket.key, bucket]));
    const paymentDateFilter = this.buildDateFilter(startDate, endDate);
    const normalizedLimit = Math.min(Math.max(Math.floor(limit || 12), 5), 30);

    const [payments, payoutBatches] = await Promise.all([
      this.prisma.payment.findMany({
        where: {
          entityId,
          ...(paymentDateFilter ? { payoutDate: paymentDateFilter } : {}),
        },
        orderBy: {
          payoutDate: 'desc',
        },
        take: normalizedLimit,
        select: {
          id: true,
          salesOrderId: true,
          channel: true,
          payoutDate: true,
          amountGrossOriginal: true,
          amountNetOriginal: true,
          feePlatformOriginal: true,
          feeGatewayOriginal: true,
          reconciledFlag: true,
          status: true,
          notes: true,
          salesOrder: {
            select: {
              externalOrderId: true,
              orderDate: true,
              status: true,
              notes: true,
              channel: {
                select: {
                  code: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.payoutImportBatch.findMany({
        where: {
          entityId,
        },
        orderBy: {
          importedAt: 'desc',
        },
        take: 6,
        select: {
          id: true,
          provider: true,
          sourceType: true,
          importedAt: true,
          fileName: true,
          recordCount: true,
          matchedCount: true,
          unmatchedCount: true,
          invalidCount: true,
          notes: true,
        },
      }),
    ]);

    const recentItems = payments.map((payment) => {
      const notes = payment.salesOrder?.notes || payment.notes;
      const fallbackNotes = payment.notes;
      const bucketKey = this.resolvePerformanceBucket({
        channelCode: payment.salesOrder?.channel?.code || payment.channel,
        notes,
        fallbackNotes,
        stores,
      });
      const bucket = bucketMap.get(bucketKey) || bucketMap.get('other');
      const metadata = {
        ...this.extractMetadata(payment.notes),
        ...this.extractMetadata(payment.salesOrder?.notes),
      };
      const feeTotal =
        Number(payment.feePlatformOriginal || 0) +
        Number(payment.feeGatewayOriginal || 0);

      return {
        paymentId: payment.id,
        salesOrderId: payment.salesOrderId,
        externalOrderId: payment.salesOrder?.externalOrderId || null,
        orderDate: payment.salesOrder?.orderDate?.toISOString() || null,
        payoutDate: payment.payoutDate?.toISOString() || null,
        channelCode: payment.salesOrder?.channel?.code || payment.channel || null,
        bucketKey,
        bucketLabel: bucket?.label || '其他業績',
        account: bucketKey.startsWith('oneshop:')
          ? bucketKey.replace('oneshop:', '')
          : null,
        storeName:
          stores.find((store) => `oneshop:${store.account}` === bucketKey)
            ?.storeName || null,
        orderStatus: payment.salesOrder?.status || null,
        paymentStatus: metadata.paymentStatus || payment.status || null,
        logisticStatus: metadata.logisticStatus || null,
        gateway: metadata.gateway || null,
        feeStatus: metadata.feeStatus || 'unavailable',
        feeSource: metadata.feeSource || null,
        settlementStatus: this.resolveSettlementStatus({
          reconciledFlag: payment.reconciledFlag,
          paymentStatus: metadata.paymentStatus || payment.status,
          rawStatus: payment.status,
        }),
        provider: this.resolveProviderSource(metadata.feeSource),
        providerPaymentId: metadata.providerPaymentId || null,
        providerTradeNo: metadata.providerTradeNo || null,
        gross: Number(payment.amountGrossOriginal || 0),
        feeTotal,
        net: Number(payment.amountNetOriginal || 0),
        reconciledFlag: payment.reconciledFlag,
      };
    });

    return {
      entityId,
      range: {
        startDate: startDate?.toISOString() || null,
        endDate: endDate?.toISOString() || null,
      },
      recentItems,
      recentBatches: payoutBatches.map((batch) => ({
        id: batch.id,
        provider: batch.provider,
        sourceType: batch.sourceType,
        importedAt: batch.importedAt.toISOString(),
        fileName: batch.fileName || null,
        recordCount: batch.recordCount,
        matchedCount: batch.matchedCount,
        unmatchedCount: batch.unmatchedCount,
        invalidCount: batch.invalidCount,
        notes: batch.notes || null,
      })),
    };
  }

  async getDashboardOperationsHub(
    entityId: string,
    startDate?: Date,
    endDate?: Date,
  ) {
    const orderDateFilter = this.buildDateFilter(startDate, endDate);
    const createdAtFilter = this.buildDateFilter(startDate, endDate);

    const [
      employeeAgg,
      payrollAgg,
      pendingLeaveAgg,
      openAnomalyAgg,
      invoiceAgg,
      pendingInvoiceAgg,
      approvalAgg,
    ] = await Promise.all([
      this.prisma.employee.aggregate({
        where: {
          entityId,
          isActive: true,
        },
        _count: {
          id: true,
        },
      }),
      this.prisma.payrollRun.groupBy({
        by: ['status'],
        where: {
          entityId,
          ...(createdAtFilter ? { createdAt: createdAtFilter } : {}),
        },
        _count: {
          _all: true,
        },
      }),
      this.prisma.leaveRequest.aggregate({
        where: {
          entityId,
          status: {
            in: ['SUBMITTED', 'UNDER_REVIEW'],
          },
          ...(createdAtFilter ? { createdAt: createdAtFilter } : {}),
        },
        _count: {
          _all: true,
        },
      }),
      this.prisma.attendanceAnomaly.aggregate({
        where: {
          entityId,
          resolvedStatus: 'open',
          ...(createdAtFilter ? { detectedAt: createdAtFilter } : {}),
        },
        _count: {
          id: true,
        },
      }),
      this.prisma.invoice.aggregate({
        where: {
          entityId,
          ...(createdAtFilter ? { createdAt: createdAtFilter } : {}),
        },
        _count: {
          id: true,
        },
        _sum: {
          totalAmountOriginal: true,
        },
      }),
      this.prisma.salesOrder.aggregate({
        where: {
          entityId,
          hasInvoice: false,
          status: {
            notIn: ['cancelled', 'refunded'],
          },
          ...(orderDateFilter ? { orderDate: orderDateFilter } : {}),
        },
        _count: {
          id: true,
        },
        _sum: {
          totalGrossOriginal: true,
        },
      }),
      this.prisma.approvalRequest.groupBy({
        by: ['type'],
        where: {
          entityId,
          status: 'pending',
          ...(createdAtFilter ? { createdAt: createdAtFilter } : {}),
        },
        _count: {
          _all: true,
        },
      }),
    ]);

    const payrollByStatus = payrollAgg.reduce<Record<string, number>>((acc, item) => {
      acc[item.status] = item._count._all
      return acc
    }, {})
    const approvalsByType = approvalAgg.reduce<Record<string, number>>((acc, item) => {
      acc[item.type] = item._count._all
      return acc
    }, {})

    return {
      entityId,
      range: {
        startDate: startDate?.toISOString() || null,
        endDate: endDate?.toISOString() || null,
      },
      people: {
        activeEmployees: Number(employeeAgg._count.id || 0),
        pendingLeaveRequests: Number(pendingLeaveAgg._count._all || 0),
        openAttendanceAnomalies: Number(openAnomalyAgg._count.id || 0),
      },
      payroll: {
        draftRuns: payrollByStatus.draft || 0,
        pendingApprovalRuns: payrollByStatus.pending_approval || 0,
        approvedRuns: payrollByStatus.approved || 0,
        postedRuns: payrollByStatus.posted || 0,
        paidRuns: payrollByStatus.paid || 0,
      },
      invoicing: {
        issuedInvoiceCount: Number(invoiceAgg._count.id || 0),
        issuedInvoiceAmount: Number(invoiceAgg._sum.totalAmountOriginal || 0),
        pendingInvoiceCount: Number(pendingInvoiceAgg._count.id || 0),
        pendingInvoiceAmount: Number(
          pendingInvoiceAgg._sum.totalGrossOriginal || 0,
        ),
      },
      approvals: {
        expenseRequests: approvalsByType.expense_request || 0,
        payrollRuns: approvalsByType.payroll_run || 0,
        journalEntries: approvalsByType.journal_entry || 0,
        payments: approvalsByType.payment || 0,
      },
      highlights: [
        {
          key: 'leave',
          label: '待審假單',
          value: Number(pendingLeaveAgg._count._all || 0),
        },
        {
          key: 'anomaly',
          label: '出勤異常',
          value: Number(openAnomalyAgg._count.id || 0),
        },
        {
          key: 'payroll',
          label: '待審薪資批次',
          value: payrollByStatus.pending_approval || 0,
        },
        {
          key: 'invoice',
          label: '待開票訂單',
          value: Number(pendingInvoiceAgg._count.id || 0),
        },
      ],
    }
  }

  async getMonthlyChannelReconciliation(
    entityId: string,
    startDate?: Date,
    endDate?: Date,
  ) {
    const stores = this.getOneShopStores();
    const buckets = this.buildDashboardBuckets(stores);
    const bucketMap = new Map(buckets.map((bucket) => [bucket.key, bucket]));
    const orderDateFilter = this.buildDateFilter(startDate, endDate);
    const paymentDateFilter = this.buildDateFilter(startDate, endDate);
    const payoutDateFilter = this.buildDateFilter(startDate, endDate);
    const payoutLineWhere = {
      provider: 'ecpay',
      batch: {
        entityId,
      },
      ...(payoutDateFilter
        ? {
            OR: [
              { payoutDate: payoutDateFilter },
              { statementDate: payoutDateFilter },
            ],
          }
        : {}),
    };

    const [orders, payments, payoutLines] = await Promise.all([
      this.prisma.salesOrder.findMany({
        where: {
          entityId,
          ...(orderDateFilter ? { orderDate: orderDateFilter } : {}),
        },
        select: {
          id: true,
          externalOrderId: true,
          orderDate: true,
          notes: true,
          totalGrossOriginal: true,
          channel: {
            select: {
              code: true,
            },
          },
        },
      }),
      this.prisma.payment.findMany({
        where: {
          entityId,
          ...(paymentDateFilter ? { payoutDate: paymentDateFilter } : {}),
        },
        select: {
          id: true,
          channel: true,
          payoutDate: true,
          amountGrossOriginal: true,
          amountNetOriginal: true,
          feePlatformOriginal: true,
          feeGatewayOriginal: true,
          reconciledFlag: true,
          notes: true,
          salesOrder: {
            select: {
              externalOrderId: true,
              orderDate: true,
              notes: true,
              channel: {
                select: {
                  code: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.payoutImportLine.findMany({
        where: payoutLineWhere,
        select: {
          status: true,
          externalOrderId: true,
          payoutDate: true,
          statementDate: true,
          batch: {
            select: {
              importedAt: true,
            },
          },
        },
      }),
    ]);

    const rows = new Map<
      string,
      {
        month: string;
        bucketKey: string;
        bucketLabel: string;
        account: string | null;
        salesGross: number;
        orderCount: number;
        payoutGross: number;
        payoutNet: number;
        feeTotal: number;
        paymentCount: number;
        reconciledCount: number;
        pendingPayoutCount: number;
        ecpayBatchLineCount: number;
        ecpayMatchedLineCount: number;
        ecpayUnmatchedLineCount: number;
      }
    >();
    const orderBucketByExternalId = new Map<string, string>();

    const ensureRow = (month: string, bucketKey: string) => {
      const key = `${month}::${bucketKey}`;
      const existing = rows.get(key);
      if (existing) {
        return existing;
      }

      const bucket = bucketMap.get(bucketKey) || bucketMap.get('other');
      const created = {
        month,
        bucketKey,
        bucketLabel: bucket?.label || '其他業績',
        account:
          bucketKey.startsWith('oneshop:') ? bucketKey.replace('oneshop:', '') : null,
        salesGross: 0,
        orderCount: 0,
        payoutGross: 0,
        payoutNet: 0,
        feeTotal: 0,
        paymentCount: 0,
        reconciledCount: 0,
        pendingPayoutCount: 0,
        ecpayBatchLineCount: 0,
        ecpayMatchedLineCount: 0,
        ecpayUnmatchedLineCount: 0,
      };
      rows.set(key, created);
      return created;
    };

    for (const order of orders) {
      const bucketKey = this.resolvePerformanceBucket({
        channelCode: order.channel?.code,
        notes: order.notes,
        stores,
      });
      const month = this.toMonthKey(order.orderDate);
      const row = ensureRow(month, bucketKey);
      row.salesGross += Number(order.totalGrossOriginal || 0);
      row.orderCount += 1;

      if (order.externalOrderId) {
        orderBucketByExternalId.set(order.externalOrderId, bucketKey);
      }
    }

    for (const payment of payments) {
      const metadata = {
        ...this.extractMetadata(payment.notes),
        ...this.extractMetadata(payment.salesOrder?.notes),
      };
      const bucketKey = this.resolvePerformanceBucket({
        channelCode: payment.salesOrder?.channel?.code || payment.channel,
        notes: payment.salesOrder?.notes || payment.notes,
        fallbackNotes: payment.notes,
        stores,
      });
      const month = this.toMonthKey(
        payment.payoutDate || payment.salesOrder?.orderDate || new Date(),
      );
      const row = ensureRow(month, bucketKey);
      const feeTotal =
        Number(payment.feePlatformOriginal || 0) +
        Number(payment.feeGatewayOriginal || 0);

      row.payoutGross += Number(payment.amountGrossOriginal || 0);
      row.payoutNet += Number(payment.amountNetOriginal || 0);
      row.feeTotal += feeTotal;
      row.paymentCount += 1;
      if (payment.reconciledFlag) {
        row.reconciledCount += 1;
      } else {
        row.pendingPayoutCount += 1;
      }
    }

    for (const line of payoutLines) {
      const bucketKey =
        (line.externalOrderId &&
          orderBucketByExternalId.get(line.externalOrderId)) ||
        'other';
      const month = this.toMonthKey(
        line.payoutDate || line.statementDate || line.batch.importedAt,
      );
      const row = ensureRow(month, bucketKey);
      row.ecpayBatchLineCount += 1;
      if (line.status === 'matched') {
        row.ecpayMatchedLineCount += 1;
      }
      if (line.status === 'unmatched') {
        row.ecpayUnmatchedLineCount += 1;
      }
    }

    const items = Array.from(rows.values())
      .map((row) => ({
        ...row,
        salesVsPayoutGap: Number((row.salesGross - row.payoutGross).toFixed(2)),
        payoutVsNetGap: Number(
          (row.payoutGross - row.payoutNet - row.feeTotal).toFixed(2),
        ),
      }))
      .sort((left, right) => {
        if (left.month === right.month) {
          return left.bucketLabel.localeCompare(right.bucketLabel, 'zh-Hant');
        }
        return right.month.localeCompare(left.month);
      });

    return {
      entityId,
      range: {
        startDate: startDate?.toISOString() || null,
        endDate: endDate?.toISOString() || null,
      },
      items,
    };
  }

  async getOrderReconciliationAudit(
    entityId: string,
    startDate?: Date,
    endDate?: Date,
    limit?: number,
  ) {
    const stores = this.getOneShopStores();
    const orderDateFilter = this.buildDateFilter(startDate, endDate);
    const normalizedLimit = Math.min(
      Math.max(Math.floor(limit || 120), 20),
      500,
    );
    const taxRate = 0.05;
    const tolerance = 1;

    const orders = await this.prisma.salesOrder.findMany({
      where: {
        entityId,
        ...(orderDateFilter ? { orderDate: orderDateFilter } : {}),
        status: {
          notIn: ['cancelled'],
        },
      },
      orderBy: {
        orderDate: 'desc',
      },
      take: normalizedLimit,
      select: {
        id: true,
        externalOrderId: true,
        orderDate: true,
        status: true,
        hasInvoice: true,
        notes: true,
        totalGrossOriginal: true,
        taxAmountOriginal: true,
        channel: {
          select: {
            code: true,
            name: true,
          },
        },
        payments: {
          orderBy: {
            payoutDate: 'desc',
          },
          select: {
            id: true,
            channel: true,
            payoutDate: true,
            status: true,
            reconciledFlag: true,
            notes: true,
            amountGrossOriginal: true,
            amountNetOriginal: true,
            feePlatformOriginal: true,
            feeGatewayOriginal: true,
            shippingFeePaidOriginal: true,
          },
        },
        invoices: {
          orderBy: {
            issuedAt: 'desc',
          },
          select: {
            id: true,
            invoiceNumber: true,
            status: true,
            invoiceType: true,
            issuedAt: true,
            amountOriginal: true,
            taxAmountOriginal: true,
            totalAmountOriginal: true,
          },
        },
      },
    });

    const items = orders.map((order) => {
      const issuedInvoices = order.invoices.filter(
        (invoice) => invoice.status !== 'void',
      );
      const latestInvoice = issuedInvoices[0] || order.invoices[0] || null;
      const latestPayment = order.payments[0] || null;
      const paymentMeta = {
        ...this.extractMetadata(latestPayment?.notes),
        ...this.extractMetadata(order.notes),
      };
      const bucketKey = this.resolvePerformanceBucket({
        channelCode: order.channel?.code,
        notes: order.notes,
        fallbackNotes: latestPayment?.notes,
        stores,
      });
      const bucket = this.buildDashboardBuckets(stores).find(
        (item) => item.key === bucketKey,
      );

      const orderGross = Number(order.totalGrossOriginal || 0);
      const orderTax = Number(order.taxAmountOriginal || 0);
      const expectedOrderTax = this.calculateIncludedTax(orderGross, taxRate);
      const paymentGross = order.payments.reduce(
        (sum, payment) => sum + Number(payment.amountGrossOriginal || 0),
        0,
      );
      const paymentNet = order.payments.reduce(
        (sum, payment) => sum + Number(payment.amountNetOriginal || 0),
        0,
      );
      const gatewayFee = order.payments.reduce(
        (sum, payment) => sum + Number(payment.feeGatewayOriginal || 0),
        0,
      );
      const platformFee = order.payments.reduce(
        (sum, payment) => sum + Number(payment.feePlatformOriginal || 0),
        0,
      );
      const shippingPaid = order.payments.reduce(
        (sum, payment) => sum + Number(payment.shippingFeePaidOriginal || 0),
        0,
      );
      const feeTotal = gatewayFee + platformFee;
      const expectedNet = Number((paymentGross - feeTotal).toFixed(2));
      const invoiceGross = issuedInvoices.reduce(
        (sum, invoice) => sum + Number(invoice.totalAmountOriginal || 0),
        0,
      );
      const invoiceTax = issuedInvoices.reduce(
        (sum, invoice) => sum + Number(invoice.taxAmountOriginal || 0),
        0,
      );
      const expectedInvoiceTax = this.calculateIncludedTax(invoiceGross, taxRate);
      const paymentCompleted = order.payments.some((payment) =>
        ['completed', 'success', 'paid', 'cod'].includes(
          (payment.status || '').toLowerCase(),
        ),
      );
      const reconciled = order.payments.some((payment) => payment.reconciledFlag);
      const anomalyCodes: string[] = [];
      const anomalyMessages: string[] = [];

      if ((paymentCompleted || reconciled) && issuedInvoices.length === 0) {
        anomalyCodes.push('missing_invoice_after_payment');
        anomalyMessages.push('訂單已付款或已對帳，但尚未找到正式發票。');
      }

      if (order.hasInvoice !== (issuedInvoices.length > 0)) {
        anomalyCodes.push('invoice_flag_mismatch');
        anomalyMessages.push('訂單發票旗標與實際發票紀錄不一致。');
      }

      if (
        issuedInvoices.length > 0 &&
        this.hasMaterialDiff(invoiceGross, orderGross, tolerance)
      ) {
        anomalyCodes.push('invoice_total_mismatch');
        anomalyMessages.push(
          `發票總額與訂單總額差 ${this.toCurrency(invoiceGross - orderGross)}。`,
        );
      }

      if (this.hasMaterialDiff(orderTax, expectedOrderTax, tolerance)) {
        anomalyCodes.push('order_tax_mismatch');
        anomalyMessages.push(
          `訂單稅額與 5% 內含稅推估差 ${this.toCurrency(orderTax - expectedOrderTax)}。`,
        );
      }

      if (
        issuedInvoices.length > 0 &&
        this.hasMaterialDiff(invoiceTax, expectedInvoiceTax, tolerance)
      ) {
        anomalyCodes.push('invoice_tax_mismatch');
        anomalyMessages.push(
          `發票稅額與發票總額推估差 ${this.toCurrency(invoiceTax - expectedInvoiceTax)}。`,
        );
      }

      if (
        paymentGross > 0 &&
        this.hasMaterialDiff(expectedNet, paymentNet, tolerance)
      ) {
        anomalyCodes.push('fee_mismatch');
        anomalyMessages.push(
          `金流手續費拆分後的淨額與實際淨額差 ${this.toCurrency(paymentNet - expectedNet)}。`,
        );
      }

      if (
        paymentGross > 0 &&
        feeTotal === 0 &&
        paymentNet < paymentGross - tolerance
      ) {
        anomalyCodes.push('fee_backfill_needed');
        anomalyMessages.push('付款紀錄顯示有被抽成，但手續費欄位尚未回填。');
      }

      if (
        paymentGross > 0 &&
        this.hasMaterialDiff(orderGross, paymentGross, tolerance)
      ) {
        anomalyCodes.push('order_payment_mismatch');
        anomalyMessages.push(
          `訂單金額與收款總額差 ${this.toCurrency(paymentGross - orderGross)}。`,
        );
      }

      if (reconciled && issuedInvoices.length === 0) {
        anomalyCodes.push('reconciled_without_invoice');
        anomalyMessages.push('款項已完成對帳，但發票仍未建立。');
      }

      const feeRatePct =
        paymentGross > 0 ? Number(((feeTotal / paymentGross) * 100).toFixed(2)) : 0;
      const severity = this.resolveAuditSeverity(anomalyCodes);
      const recommendation = this.buildAuditRecommendation(anomalyCodes);

      return {
        orderId: order.id,
        externalOrderId: order.externalOrderId || null,
        orderDate: order.orderDate.toISOString(),
        orderStatus: order.status,
        channelCode: order.channel?.code || null,
        channelName: order.channel?.name || bucket?.label || '未知通路',
        bucketKey,
        bucketLabel: bucket?.label || '其他業績',
        hasInvoice: order.hasInvoice,
        invoiceNumber: latestInvoice?.invoiceNumber || null,
        invoiceStatus: latestInvoice?.status || null,
        invoiceIssuedAt: latestInvoice?.issuedAt?.toISOString() || null,
        paymentStatus: latestPayment?.status || null,
        reconciledFlag: reconciled,
        grossAmount: orderGross,
        orderTaxAmount: orderTax,
        expectedOrderTaxAmount: expectedOrderTax,
        paymentGrossAmount: paymentGross,
        paymentNetAmount: paymentNet,
        gatewayFeeAmount: gatewayFee,
        platformFeeAmount: platformFee,
        shippingPaidAmount: shippingPaid,
        feeTotalAmount: feeTotal,
        feeRatePct,
        invoiceGrossAmount: invoiceGross,
        invoiceTaxAmount: invoiceTax,
        expectedInvoiceTaxAmount: expectedInvoiceTax,
        providerTradeNo: paymentMeta.providerTradeNo || null,
        providerPaymentId: paymentMeta.providerPaymentId || null,
        anomalyCodes,
        anomalyMessages,
        severity,
        recommendation,
      };
    });

    const summary = items.reduce(
      (acc, item) => {
        const hasFeeIssue = item.anomalyCodes.some((code) =>
          ['fee_mismatch', 'fee_backfill_needed'].includes(code),
        );
        const hasInvoiceIssue = item.anomalyCodes.some((code) =>
          [
            'missing_invoice_after_payment',
            'invoice_flag_mismatch',
            'invoice_total_mismatch',
            'reconciled_without_invoice',
          ].includes(code),
        );
        const hasTaxIssue = item.anomalyCodes.some((code) =>
          ['order_tax_mismatch', 'invoice_tax_mismatch'].includes(code),
        );
        const hasOrderPaymentIssue = item.anomalyCodes.includes(
          'order_payment_mismatch',
        );

        acc.auditedOrderCount += 1;
        acc.anomalousOrderCount += item.anomalyCodes.length ? 1 : 0;
        acc.paidOrderCount += item.paymentGrossAmount > 0 ? 1 : 0;
        acc.invoicedOrderCount += item.invoiceGrossAmount > 0 ? 1 : 0;
        acc.reconciledOrderCount += item.reconciledFlag ? 1 : 0;
        acc.totalGrossAmount += item.grossAmount;
        acc.totalPaymentGrossAmount += item.paymentGrossAmount;
        acc.totalPaymentNetAmount += item.paymentNetAmount;
        acc.totalGatewayFeeAmount += item.gatewayFeeAmount;
        acc.totalPlatformFeeAmount += item.platformFeeAmount;
        acc.totalFeeAmount += item.feeTotalAmount;
        acc.flaggedGrossAmount += item.anomalyCodes.length ? item.grossAmount : 0;
        acc.flaggedFeeAmount += hasFeeIssue ? item.feeTotalAmount : 0;
        acc.invoiceIssueCount += hasInvoiceIssue ? 1 : 0;
        acc.taxIssueCount += hasTaxIssue ? 1 : 0;
        acc.feeIssueCount += hasFeeIssue ? 1 : 0;
        acc.orderPaymentIssueCount += hasOrderPaymentIssue ? 1 : 0;
        return acc;
      },
      {
        auditedOrderCount: 0,
        anomalousOrderCount: 0,
        paidOrderCount: 0,
        invoicedOrderCount: 0,
        reconciledOrderCount: 0,
        invoiceIssueCount: 0,
        taxIssueCount: 0,
        feeIssueCount: 0,
        orderPaymentIssueCount: 0,
        totalGrossAmount: 0,
        totalPaymentGrossAmount: 0,
        totalPaymentNetAmount: 0,
        totalGatewayFeeAmount: 0,
        totalPlatformFeeAmount: 0,
        totalFeeAmount: 0,
        flaggedGrossAmount: 0,
        flaggedFeeAmount: 0,
      },
    );

    const anomalyItems = items
      .filter((item) => item.anomalyCodes.length > 0)
      .sort((left, right) => {
        const severityRank = { critical: 0, warning: 1, healthy: 2 };
        const severityDiff =
          severityRank[left.severity] - severityRank[right.severity];
        if (severityDiff !== 0) {
          return severityDiff;
        }
        return (
          new Date(right.orderDate).getTime() - new Date(left.orderDate).getTime()
        );
      });

    return {
      entityId,
      range: {
        startDate: startDate?.toISOString() || null,
        endDate: endDate?.toISOString() || null,
      },
      summary: {
        ...summary,
        feeTakeRatePct:
          summary.totalPaymentGrossAmount > 0
            ? Number(
                (
                  (summary.totalFeeAmount / summary.totalPaymentGrossAmount) *
                  100
                ).toFixed(2),
              )
            : 0,
      },
      items: anomalyItems,
    };
  }

  /**
   * 損益表 (Income Statement / P&L)
   * 已在 AccountingModule 實作，這裡提供增強版
   */
  async getIncomeStatement(entityId: string, startDate: Date, endDate: Date) {
    // TODO: 呼叫 AccountingService.getIncomeStatement
    // TODO: 增加比較期間功能
    // TODO: 增加預算比較
  }

  /**
   * 資產負債表 (Balance Sheet)
   */
  async getBalanceSheet(entityId: string, asOfDate: Date) {
    // TODO: 呼叫 AccountingService.getBalanceSheet
  }

  /**
   * 現金流量表 (Cash Flow Statement)
   */
  async getCashFlowStatement(entityId: string, startDate: Date, endDate: Date) {
    // TODO: 分類：營運活動、投資活動、融資活動
  }

  /**
   * 權益變動表 (Statement of Changes in Equity)
   */
  async getEquityStatement(entityId: string, startDate: Date, endDate: Date) {
    // TODO: 追蹤股本、保留盈餘變動
  }

  /**
   * 銷售分析報表
   */
  async getSalesAnalysis(
    entityId: string,
    groupBy: 'channel' | 'product' | 'customer',
    period: { start: Date; end: Date },
  ) {
    // TODO: 依渠道、商品、客戶分組分析銷售
  }

  /**
   * 成本分析報表
   */
  async getCostAnalysis(entityId: string, period: { start: Date; end: Date }) {
    // TODO: 分析各類成本占比
  }

  /**
   * 費用分析報表
   */
  async getExpenseAnalysis(
    entityId: string,
    groupBy: 'category' | 'department',
    period: { start: Date; end: Date },
  ) {
    // TODO: 依類別或部門分析費用
  }

  /**
   * 毛利分析
   */
  async getGrossMarginAnalysis(
    entityId: string,
    groupBy: 'product' | 'channel',
    period: { start: Date; end: Date },
  ) {
    // TODO: 計算各商品或渠道的毛利率
  }

  /**
   * 庫存報表
   */
  async getInventoryReport(entityId: string, asOfDate: Date) {
    // TODO: 列出所有庫存及其成本
  }

  /**
   * 自訂報表查詢
   */
  async executeCustomQuery(sql: string, params: any[]) {
    // TODO: 執行自訂SQL查詢（需權限控制）
  }

  /**
   * 匯出報表為Excel
   */
  async exportToExcel(reportType: string, data: any) {
    // TODO: 使用 xlsx 套件匯出
  }

  /**
   * 匯出報表為PDF
   */
  async exportToPDF(reportType: string, data: any) {
    // TODO: 使用 pdfkit 或 puppeteer 產生PDF
  }

  private buildDateFilter(startDate?: Date, endDate?: Date) {
    const filter: { gte?: Date; lte?: Date } = {};
    if (startDate) {
      filter.gte = startDate;
    }
    if (endDate) {
      filter.lte = endDate;
    }
    return Object.keys(filter).length ? filter : null;
  }

  private buildDashboardBuckets(
    stores: Array<{ account: string; storeName?: string }>,
  ) {
    return [
      {
        key: 'shopify',
        label: 'Shopify 官網業績',
      },
      {
        key: 'shopline',
        label: 'Shopline 業績',
      },
      ...stores.slice(0, 2).map((store, index) => ({
        key: `oneshop:${store.account}`,
        label: store.storeName || `1shop 帳號 ${index + 1}`,
        account: store.account,
        storeName: store.storeName || null,
      })),
      {
        key: 'other',
        label: '其他業績',
      },
    ];
  }

  private getOneShopStores() {
    const storesJson =
      this.configService.get<string>('ONESHOP_STORES_JSON', '') || '';

    if (!storesJson.trim()) {
      return [] as Array<{ account: string; storeName?: string }>;
    }

    try {
      const parsed = JSON.parse(storesJson);
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed
        .map((store) => ({
          account:
            typeof store?.account === 'string' ? store.account.trim() : '',
          storeName:
            typeof store?.storeName === 'string'
              ? store.storeName.trim()
              : '',
        }))
        .filter((store) => store.account);
    } catch {
      return [];
    }
  }

  private resolvePerformanceBucket(params: {
    channelCode?: string | null;
    notes?: string | null;
    fallbackNotes?: string | null;
    stores: Array<{ account: string; storeName?: string }>;
  }) {
    const channelCode = (params.channelCode || '').trim().toUpperCase();
    const primaryMeta = this.extractMetadata(params.notes);
    const fallbackMeta = this.extractMetadata(params.fallbackNotes);
    const storeAccount =
      primaryMeta.storeAccount || fallbackMeta.storeAccount || '';

    if (channelCode === 'SHOPIFY') {
      return 'shopify';
    }

    if (channelCode === 'SHOPLINE') {
      return 'shopline';
    }

    if (channelCode === '1SHOP') {
      const matchedStore = params.stores.find(
        (store) => store.account === storeAccount,
      );
      if (matchedStore) {
        return `oneshop:${matchedStore.account}`;
      }
    }

    return 'other';
  }

  private resolveSettlementStatus(params: {
    reconciledFlag: boolean;
    paymentStatus?: string | null;
    rawStatus?: string | null;
  }) {
    if (params.reconciledFlag) {
      return 'reconciled';
    }

    const paymentStatus = (params.paymentStatus || '').trim().toLowerCase();
    const rawStatus = (params.rawStatus || '').trim().toLowerCase();

    if (
      ['paid', 'cod', 'completed', 'success'].includes(paymentStatus) ||
      ['completed', 'success'].includes(rawStatus)
    ) {
      return 'pending_payout';
    }

    if (['failed', 'cancelled', 'refunded'].includes(paymentStatus)) {
      return 'failed';
    }

    return 'pending_payment';
  }

  private resolveProviderSource(feeSource?: string | null) {
    const value = (feeSource || '').trim().toLowerCase();
    if (value.startsWith('provider-payout:ecpay')) {
      return 'ecpay';
    }
    if (value.startsWith('provider-payout:hitrust')) {
      return 'hitrust';
    }
    return null;
  }

  private extractMetadata(notes?: string | null) {
    const lines = (notes || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const meta: Record<string, string> = {};

    for (const line of lines) {
      const separator = line.indexOf('] ');
      const raw = separator >= 0 ? line.slice(separator + 2) : line;
      for (const pair of raw.split(';')) {
        const [key, ...rest] = pair.split('=');
        if (!key || !rest.length) {
          continue;
        }
        meta[key.trim()] = rest.join('=').trim();
      }
    }

    return meta;
  }

  private toMonthKey(date: Date | string) {
    const value = date instanceof Date ? date : new Date(date);
    return value.toISOString().slice(0, 7);
  }

  private calculateIncludedTax(grossAmount: number, taxRate: number) {
    if (!grossAmount) {
      return 0;
    }
    return Number((grossAmount - grossAmount / (1 + taxRate)).toFixed(2));
  }

  private hasMaterialDiff(left: number, right: number, tolerance: number) {
    return Math.abs(Number(left || 0) - Number(right || 0)) > tolerance;
  }

  private toCurrency(amount: number) {
    const normalized = Number(amount || 0);
    return `NT$ ${normalized.toFixed(2)}`;
  }

  private resolveAuditSeverity(anomalyCodes: string[]) {
    if (
      anomalyCodes.some((code) =>
        [
          'missing_invoice_after_payment',
          'invoice_total_mismatch',
          'invoice_tax_mismatch',
          'order_payment_mismatch',
        ].includes(code),
      )
    ) {
      return 'critical' as const;
    }

    if (anomalyCodes.length > 0) {
      return 'warning' as const;
    }

    return 'healthy' as const;
  }

  private buildAuditRecommendation(anomalyCodes: string[]) {
    if (
      anomalyCodes.some((code) =>
        ['missing_invoice_after_payment', 'reconciled_without_invoice'].includes(
          code,
        ),
      )
    ) {
      return '先補發票，再確認會計分錄與稅務申報是否應同步回寫。';
    }

    if (anomalyCodes.includes('order_payment_mismatch')) {
      return '優先核對平台訂單金額、綠界撥款與退款/折讓是否一致。';
    }

    if (
      anomalyCodes.some((code) =>
        ['fee_mismatch', 'fee_backfill_needed'].includes(code),
      )
    ) {
      return '請補回金流手續費欄位，並確認綠界匯入的淨額是否為最終值。';
    }

    if (
      anomalyCodes.some((code) =>
        ['order_tax_mismatch', 'invoice_tax_mismatch'].includes(code),
      )
    ) {
      return '請先檢查稅別設定，再確認發票稅額與平台含稅金額是否採同一口徑。';
    }

    return '這筆資料目前沒有明顯異常，可繼續觀察撥款與入帳狀態。';
  }
}
