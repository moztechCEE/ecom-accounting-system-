import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SnLabelsExport } from './sn-labels.export';
import { randomUUID } from 'crypto';
import { isDeepStrictEqual } from 'util';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  allocationRule,
  cartonId,
  serial,
  validateDraft,
} from './sn-labels.rules';

@Injectable()
export class SnLabelsService {
  constructor(
    private readonly db: PrismaService,
    private readonly exporter: SnLabelsExport,
  ) {}
  async event(
    tx: any,
    entity: string,
    actor: string,
    action: string,
    data: any,
    batch: string | null = null,
  ) {
    await tx.$executeRaw`INSERT INTO sn_label_events(id,entity_id,batch_id,actor_id,action,data) VALUES(${randomUUID()},${entity},${batch},${actor},${action},${JSON.stringify(data)}::jsonb)`;
  }
  async save(entity: string, actor: string, id: string, body: any) {
    if (
      !/^[a-zA-Z0-9-]{1,100}$/.test(id) ||
      !Number.isInteger(body?.revision) ||
      body.revision < 0
    )
      throw new BadRequestException('草稿版本錯誤，請重新讀取');
    const data = validateDraft(body.data);
    if (
      data.productId &&
      !(await this.db.product.findFirst({
        where: { id: data.productId, entityId: entity },
      }))
    )
      throw new NotFoundException('找不到此公司的產品');
    return this.db.$transaction(async (tx) => {
      if (body.revision === 0) {
        const count =
          await tx.$executeRaw`INSERT INTO sn_label_drafts(id,entity_id,data,created_by) VALUES(${id},${entity},${JSON.stringify(data)}::jsonb,${actor}) ON CONFLICT(id) DO NOTHING`;
        if (!count) throw new ConflictException('草稿已存在，請重新載入');
      } else {
        const count =
          await tx.$executeRaw`UPDATE sn_label_drafts SET data=${JSON.stringify(data)}::jsonb,revision=revision+1,updated_at=now() WHERE id=${id} AND entity_id=${entity} AND revision=${body.revision} AND batch_id IS NULL`;
        if (!count)
          throw new ConflictException('草稿已被更新或啟用，請重新載入');
      }
      await this.event(tx, entity, actor, 'SAVE_DRAFT', {
        draftId: id,
        revision: body.revision + 1,
      });
      return { id, revision: body.revision + 1, data };
    });
  }
  async list(entity: string, q: any) {
    const term = String(q.search || '')
        .trim()
        .slice(0, 100),
      start = String(q.start || ''),
      end = String(q.end || '');
    const status = ['draft', 'active'].includes(q.status) ? q.status : '';
    const page = Math.max(1, Math.min(100000, Number(q.page) || 1));
    const rows = await this.db.$queryRaw<any[]>`
   SELECT *,count(*) OVER()::int AS total FROM (
    SELECT id,'draft' AS status,revision,data,updated_at FROM sn_label_drafts WHERE entity_id=${entity} AND batch_id IS NULL
    UNION ALL SELECT id,'active' AS status,0 AS revision,data || jsonb_build_object('quantity',quantity),updated_at FROM sn_label_batches WHERE entity_id=${entity}
   ) entries WHERE (${status}='' OR status=${status})
    AND (${term}='' OR strpos(lower(data->>'name'),lower(${term}))>0 OR strpos(lower(data->>'productName'),lower(${term}))>0 OR strpos(data->>'barcode',${term})>0 OR strpos(lower(data->>'model'),lower(${term}))>0)
    AND (${start}='' OR data->>'orderDate'>=${start}) AND (${end}='' OR data->>'orderDate'<=${end})
   ORDER BY CASE WHEN ${q.sort === 'asc'} THEN data->>'orderDate' END ASC,
    CASE WHEN ${q.sort !== 'asc'} THEN data->>'orderDate' END DESC,updated_at DESC LIMIT 30 OFFSET ${(page - 1) * 30}`;
    return { rows, total: rows[0]?.total || 0, page };
  }
  async activate(entity: string, actor: string, id: string, revision: number) {
    if (!Number.isInteger(revision) || revision < 1)
      throw new BadRequestException('請先儲存草稿');
    return this.db.$transaction(
      async (tx) => {
        // All allocations share this database lock, across processes and companies.
        // It also serializes printable-prefix registration and global carton numbering.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(726220926)`;
        const [draft] = await tx.$queryRaw<
          any[]
        >`SELECT * FROM sn_label_drafts WHERE id=${id} AND entity_id=${entity} FOR UPDATE`;
        if (!draft) throw new NotFoundException('找不到草稿');
        if (draft.batch_id) return { batchId: draft.batch_id, replayed: true };
        if (draft.revision !== revision)
          throw new ConflictException('草稿已被其他人更新，請重新核對');
        const d = validateDraft(draft.data),
          r = allocationRule(entity, d);
        const product = await tx.product.findFirst({
          where: { id: d.productId, entityId: entity, isActive: true },
        });
        if (!product || product.barcode !== d.barcode || product.sku !== d.sku)
          throw new ConflictException('產品資料已異動或停用，請重新選取產品');
        const [collision] = await tx.$queryRaw<
          any[]
        >`SELECT scope FROM sn_label_counters WHERE prefix=${r.prefix}`;
        if (collision && collision.scope !== r.scope)
          throw new ConflictException(
            '這組代碼與既有 SN 前綴相同，請使用不會重複的代碼',
          );
        await tx.$executeRaw`INSERT INTO sn_label_counters(scope,prefix) VALUES(${r.scope},${r.prefix}) ON CONFLICT(scope) DO NOTHING`;
        const [counter] = await tx.$queryRaw<
          any[]
        >`SELECT last_value FROM sn_label_counters WHERE scope=${r.scope} FOR UPDATE`;
        const first = counter.last_value + 1,
          last = counter.last_value + d.quantity;
        serial(r.prefix, last);
        // Validate printability before reserving any serials. Failed layouts roll back.
        await this.exporter.pdf(
          'labels',
          d,
          [{ sn: serial(r.prefix, last) }],
          [],
        );
        await this.exporter.pdf(
          'cartons',
          d,
          [],
          [
            {
              id: cartonId(d, 999999),
              quantity: Math.min(d.quantity, d.capacity!),
              serials: Array.from(
                { length: Math.min(d.quantity, d.capacity!) },
                (_, i) => serial(r.prefix, first + i),
              ),
            },
          ],
        );
        let [batch] = await tx.$queryRaw<
          any[]
        >`SELECT * FROM sn_label_batches WHERE merge_key=${r.mergeKey}`;
        if (
          batch &&
          (batch.data.capacity !== d.capacity ||
            batch.data.manufactureDate !== d.manufactureDate ||
            !isDeepStrictEqual(batch.data.label, d.label) ||
            batch.data.cartonWidth !== d.cartonWidth ||
            batch.data.cartonHeight !== d.cartonHeight)
        )
          throw new ConflictException(
            '同日追加需沿用原批次的製造日期、箱容量及標籤設定；請從原批次按「追加數量」',
          );
        if (!batch) {
          batch = { id: randomUUID() };
          await tx.$executeRaw`INSERT INTO sn_label_batches(id,entity_id,merge_key,data,created_by) VALUES(${batch.id},${entity},${r.mergeKey},${JSON.stringify(d)}::jsonb,${actor})`;
        }
        await tx.$executeRaw`INSERT INTO sn_label_carton_counters(scope) VALUES(${r.cartonScope}) ON CONFLICT(scope) DO NOTHING`;
        const [cc] = await tx.$queryRaw<
          any[]
        >`SELECT last_value FROM sn_label_carton_counters WHERE scope=${r.cartonScope} FOR UPDATE`;
        const [bc] = await tx.$queryRaw<
          any[]
        >`SELECT count(*)::int AS n FROM sn_label_cartons WHERE batch_id=${batch.id}`;
        const boxes: any[] = [],
          items: any[] = [];
        for (let offset = 0; offset < d.quantity; offset += d.capacity!) {
          const boxIndex = boxes.length,
            quantity = Math.min(d.capacity!, d.quantity - offset),
            box = cartonId(d, cc.last_value + boxIndex + 1);
          boxes.push({
            id: box,
            batch_id: batch.id,
            source_id: id,
            ordinal: bc.n + boxIndex + 1,
            quantity,
          });
          for (let i = 0; i < quantity; i++)
            items.push({
              sn: serial(r.prefix, first + offset + i),
              batch_id: batch.id,
              source_id: id,
              carton_id: box,
              sequence: first + offset + i,
              position: i + 1,
            });
        }
        await tx.$executeRaw`INSERT INTO sn_label_cartons SELECT * FROM jsonb_to_recordset(${JSON.stringify(boxes)}::jsonb) AS x(id text,batch_id text,source_id text,ordinal int,quantity int)`;
        await tx.$executeRaw`INSERT INTO sn_label_serials SELECT * FROM jsonb_to_recordset(${JSON.stringify(items)}::jsonb) AS x(sn text,batch_id text,source_id text,carton_id text,sequence int,position int)`;
        await tx.$executeRaw`UPDATE sn_label_counters SET last_value=${last} WHERE scope=${r.scope}`;
        await tx.$executeRaw`UPDATE sn_label_carton_counters SET last_value=last_value+${boxes.length} WHERE scope=${r.cartonScope}`;
        await tx.$executeRaw`UPDATE sn_label_batches SET quantity=quantity+${d.quantity},updated_at=now() WHERE id=${batch.id}`;
        await tx.$executeRaw`UPDATE sn_label_drafts SET batch_id=${batch.id},updated_at=now() WHERE id=${id}`;
        await this.event(
          tx,
          entity,
          actor,
          'ALLOCATE',
          {
            draftId: id,
            revision,
            first,
            last,
            quantity: d.quantity,
            cartons: boxes.map((b) => b.id),
          },
          batch.id,
        );
        return { batchId: batch.id, first, last, replayed: false };
      },
      { timeout: 60000, maxWait: 30000 },
    );
  }
  async detail(entity: string, id: string, page = 1) {
    const [b] = await this.db.$queryRaw<
      any[]
    >`SELECT * FROM sn_label_batches WHERE id=${id} AND entity_id=${entity}`;
    if (!b) throw new NotFoundException('找不到已啟用批次');
    const [counts] = await this.db.$queryRaw<
      any[]
    >`SELECT min(sequence)::int AS first,max(sequence)::int AS last,count(DISTINCT carton_id)::int AS cartons FROM sn_label_serials WHERE batch_id=${id}`;
    const boxes = await this.db.$queryRaw<
      any[]
    >`SELECT c.*, (SELECT jsonb_agg(s.sn ORDER BY s.position) FROM sn_label_serials s WHERE s.carton_id=c.id) AS serials FROM sn_label_cartons c WHERE batch_id=${id} ORDER BY ordinal LIMIT 20 OFFSET ${(Math.max(1, Number(page) || 1) - 1) * 20}`;
    const events = await this.db.$queryRaw<
      any[]
    >`SELECT actor_id,action,data,created_at FROM sn_label_events WHERE batch_id=${id} ORDER BY created_at DESC LIMIT 100`;
    return {
      id: b.id,
      data: { ...b.data, quantity: b.quantity },
      ...counts,
      boxes,
      events,
    };
  }
  async exportData(
    entity: string,
    id: string,
    from: number,
    to: number,
    kind: string,
  ) {
    const [b] = await this.db.$queryRaw<
      any[]
    >`SELECT * FROM sn_label_batches WHERE id=${id} AND entity_id=${entity}`;
    if (!b) throw new NotFoundException('找不到已啟用批次');
    if (
      !Number.isInteger(from) ||
      !Number.isInteger(to) ||
      from < 1 ||
      to < from ||
      to > 999999 ||
      to - from > 9999
    )
      throw new BadRequestException(
        '請選擇有效的流水號範圍，每次最多 10,000 個',
      );
    const items = await this.db.$queryRaw<
      any[]
    >`SELECT * FROM sn_label_serials WHERE batch_id=${id} AND sequence>=${from} AND sequence<=${to} ORDER BY sequence`;
    if (!items.length) throw new BadRequestException('所選範圍沒有已配發 SN');
    if (kind.startsWith('carton')) {
      const selected = items.map((i) => i.carton_id);
      const boxes = await this.db.$queryRaw<
        any[]
      >`SELECT c.*, (SELECT jsonb_agg(s.sn ORDER BY s.position) FROM sn_label_serials s WHERE s.carton_id=c.id) AS serials FROM sn_label_cartons c WHERE c.batch_id=${id} AND c.id IN (SELECT jsonb_array_elements_text(${JSON.stringify(selected)}::jsonb)) ORDER BY c.ordinal`;
      return { data: b.data, items, boxes }; // Carton exports always retain full box contents.
    }
    return { data: b.data, items, boxes: [] };
  }
}
