import 'reflect-metadata';
import process from 'node:process';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { ReconciliationService } from '../modules/reconciliation/reconciliation.service';
import { LinePayService } from '../modules/reconciliation/line-pay.service';
import { ProviderPayoutReconciliationService } from '../modules/reconciliation/provider-payout-reconciliation.service';

function getArg(name: string): string | undefined {
  const idx = process.argv.findIndex((value) => value === name);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function parseDateArg(value: string | undefined, fallback: Date): Date {
  if (!value?.trim()) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date: ${value}`);
  }
  return date;
}

function toDayStart(date: Date): Date {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function toDayEnd(date: Date): Date {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

async function main() {
  const entityId = (getArg('--entityId') || 'tw-entity-001').trim();
  const endDate = toDayEnd(parseDateArg(getArg('--endDate'), new Date()));
  const beginDate = toDayStart(
    parseDateArg(
      getArg('--beginDate'),
      new Date(endDate.getTime() - 29 * 24 * 60 * 60 * 1000),
    ),
  );
  const orderWindowDays = Number(getArg('--orderWindowDays') || 14);
  const payoutWindowDays = Number(getArg('--payoutWindowDays') || 31);
  const linePayLimit = Number(getArg('--linePayLimit') || 300);
  const invoiceBatchLimit = Number(getArg('--invoiceBatchLimit') || 200);
  const autoClear = hasFlag('--auto-clear');
  const processLinePayRefundReversals = hasFlag(
    '--process-linepay-refund-reversals',
  );
  const userId = getArg('--userId') || 'system-closure-pass';

  // eslint-disable-next-line no-console
  console.log(
    `[closure-pass] entity=${entityId} range=${beginDate.toISOString()} ~ ${endDate.toISOString()}`,
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const reconciliationService = app.get(ReconciliationService);
    const linePayService = app.get(LinePayService);
    const providerPayoutService = app.get(ProviderPayoutReconciliationService);

    // eslint-disable-next-line no-console
    console.log('[closure-pass] step=oneshop-groupbuy-closure');
    const closureResult =
      await reconciliationService.backfillOneShopGroupbuyClosure({
        entityId,
        beginDate,
        endDate,
        orderWindowDays,
        payoutWindowDays,
        invoiceBatchLimit,
        autoClear,
        userId,
      });

    // eslint-disable-next-line no-console
    console.log(
      `[closure-pass] oneshop success=${closureResult.success} steps=${closureResult.steps.length}`,
    );

    // eslint-disable-next-line no-console
    console.log('[closure-pass] step=linepay-refresh');
    const refreshed = await linePayService.refreshImportedPayoutStatuses({
      entityId,
      startDate: beginDate,
      endDate,
      limit: linePayLimit,
    });
    // eslint-disable-next-line no-console
    console.log(
      `[closure-pass] linepay checked=${refreshed.checkedCount} refundCandidates=${refreshed.refundCandidateCount} failures=${refreshed.failedCount}`,
    );

    let reversals = {
      success: true,
      scanned: 0,
      reversed: 0,
      unmatched: 0,
      skipped: 0,
      results: [],
    };

    if (processLinePayRefundReversals) {
      // eslint-disable-next-line no-console
      console.log('[closure-pass] step=linepay-refund-reversal');
      reversals =
        await providerPayoutService.processPendingLinePayRefundReversals({
          entityId,
          startDate: beginDate,
          endDate,
          limit: linePayLimit,
          userId,
        });
    } else {
      // eslint-disable-next-line no-console
      console.log(
        '[closure-pass] step=linepay-refund-reversal skipped; pass --process-linepay-refund-reversals to write reversal journals',
      );
    }
    // eslint-disable-next-line no-console
    console.log(
      `[closure-pass] reversals reversed=${reversals.reversed} unmatched=${reversals.unmatched} skipped=${reversals.skipped}`,
    );

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          success:
            closureResult.success &&
            refreshed.failedCount === 0 &&
            reversals.success,
          entityId,
          range: {
            beginDate: beginDate.toISOString(),
            endDate: endDate.toISOString(),
          },
          oneShopClosure: closureResult,
          linePayRefresh: refreshed,
          linePayRefundReversals: reversals,
        },
        null,
        2,
      ),
    );
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('[closure-pass] failed', error);
  process.exit(1);
});
