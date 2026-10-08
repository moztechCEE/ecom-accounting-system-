import { useEffect, useRef, useState } from "react";
import { Alert, Button, Image, Space, Spin, Typography } from "antd";
import { PictureOutlined } from "@ant-design/icons";
import api from "../../services/api";
import { errorText } from "./model";
class SourcePhotoValidationError extends Error {}
type Attachment = { id: string; fileName: string; contentType: string; scope: "CASE" };
/** Source attachments describe the whole case, rather than an individual product. */
export default function SourceCasePhotos({ entityId, caseId, active }: { entityId: string; caseId: string; active: boolean }) {
  const [opened, setOpened] = useState(false), [revision, setRevision] = useState(0);
  const [snapshot, setSnapshot] = useState<{ scope: string; items: Attachment[]; hasMore?: boolean; error?: string }>();
  const [photos, setPhotos] = useState<{ scope: string; entries: Record<string, { url?: string; error?: string; busy?: boolean }> }>({ scope: "", entries: {} });
  const generation = useRef(0), objectUrls = useRef(new Set<string>());
  const scope = `${entityId}:${caseId}:${revision}`, validSnapshot = snapshot?.scope === scope ? snapshot : undefined;
  const entries = photos.scope === scope ? photos.entries : {};
  useEffect(() => {
    const ticket = ++generation.current; const controller = new AbortController();
    const ownedUrls = objectUrls.current;
    if (active && opened) void api.get<{ items: Attachment[]; hasMore?: boolean }>(`/mailroom/source-cases/${encodeURIComponent(caseId)}/attachments`, { params: { entityId }, signal: controller.signal })
      .then(result => { if (ticket === generation.current) setSnapshot({ scope, items: result.data.items, hasMore: result.data.hasMore }); })
      .catch(error => { if (ticket === generation.current && !controller.signal.aborted) setSnapshot({ scope, items: [], error: errorText(error) }); });
    return () => { controller.abort(); generation.current++; ownedUrls.forEach(url => URL.revokeObjectURL(url)); ownedUrls.clear(); };
  }, [active, opened, caseId, entityId, scope, revision]);
  async function load(attachment: Attachment) {
    const ticket = generation.current;
    const update = (entry: { url?: string; error?: string; busy?: boolean }) => setPhotos(previous => ({ scope, entries: { ...(previous.scope === scope ? previous.entries : {}), [attachment.id]: entry } }));
    update({ busy: true });
    try {
      const response = await api.get<Blob>(`/mailroom/source-cases/${encodeURIComponent(caseId)}/attachments/${encodeURIComponent(attachment.id)}/media`, { params: { entityId }, responseType: "blob" });
      if (ticket !== generation.current) return;
      if (!["image/png", "image/jpeg", "image/webp"].includes(response.data.type) || response.data.size > 1024 * 1024) throw new SourcePhotoValidationError("照片格式或大小不符");
      const url = URL.createObjectURL(response.data); objectUrls.current.add(url); update({ url });
    } catch (error) { if (ticket === generation.current) update({ error: error instanceof SourcePhotoValidationError ? error.message : errorText(error) }); }
  }
  return <div className="mailroom-source-photos">
    <Button type="link" icon={<PictureOutlined aria-hidden />} onClick={() => { setRevision(value => value + 1); setOpened(value => !value); }}>{opened ? "收起案件照片" : "查看售後案件照片"}</Button>
    {opened && <>
      {!validSnapshot ? <Spin size="small" /> : validSnapshot.error ? <Alert type="warning" message="案件照片無法載入" description={validSnapshot.error} action={<Button onClick={() => setRevision(value => value + 1)}>重試</Button>} />
        : !validSnapshot.items.length ? <Typography.Text type="secondary">此案件未提供可預覽的照片</Typography.Text>
          : <><div><Typography.Text type="secondary">來源案件照片</Typography.Text></div><Space wrap><Image.PreviewGroup>{validSnapshot.items.map(attachment => <div key={attachment.id}>
            {entries[attachment.id]?.url ? <Image src={entries[attachment.id].url} width={96} height={96} style={{ objectFit: "cover" }} alt={`來源案件照片：${attachment.fileName}`} />
              : <Button loading={entries[attachment.id]?.busy} onClick={() => void load(attachment)}>{attachment.fileName || "查看照片"}</Button>}
            {entries[attachment.id]?.error && <div role="alert"><Typography.Text type="danger">{entries[attachment.id].error}</Typography.Text></div>}
          </div>)}</Image.PreviewGroup></Space>{validSnapshot.hasMore && <div><Typography.Text type="secondary">目前顯示最近 12 張；其他附件可至原售後案件查看。</Typography.Text></div>}</>}
    </>}
  </div>;
}
