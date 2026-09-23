import { useEffect, useState } from "react";
import { Alert, Empty, Image, Space, Typography } from "antd";

type Evidence = { name: string; url: string; mimeType?: string };
type Preview = Evidence & { previewUrl: string; image: boolean };

function prepare(raw: unknown, index: number): Preview | null {
  if (!raw || typeof raw !== "object") return null;
  const file = raw as Partial<Evidence>;
  if (typeof file.url !== "string") return null;
  const name = typeof file.name === "string" ? file.name : `附件 ${index + 1}`;
  const inline =
    /^data:(image\/(?:png|jpeg|webp)|application\/pdf);base64,([A-Za-z0-9+/]+={0,2})$/.exec(
      file.url,
    );
  if (inline) {
    if (inline[2].length > 7_000_000) return null;
    try {
      const bytes = Uint8Array.from(atob(inline[2]), (value) =>
        value.charCodeAt(0),
      );
      return {
        name,
        url: file.url,
        mimeType: inline[1],
        image: inline[1].startsWith("image/"),
        previewUrl: URL.createObjectURL(new Blob([bytes], { type: inline[1] })),
      };
    } catch {
      return null;
    }
  }
  try {
    const url = new URL(file.url);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return {
      name,
      url: file.url,
      mimeType: file.mimeType,
      previewUrl: file.url,
      image: /^image\/(png|jpeg|webp)$/.test(file.mimeType || ""),
    };
  } catch {
    return null;
  }
}

export default function ReceiptEvidenceViewer({
  files,
  attachmentUrl,
}: {
  files?: unknown[] | null;
  attachmentUrl?: string | null;
}) {
  const [previews, setPreviews] = useState<Preview[]>([]);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    const source = files?.length
      ? files
      : attachmentUrl
        ? [{ name: "原始附件", url: attachmentUrl }]
        : [];
    const converted = source.map(prepare);
    const valid = converted.filter((file): file is Preview => Boolean(file));
    // Blob URLs are external resources; allocate and revoke them in this effect, never during render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPreviews(valid);
    setInvalid(converted.some((file) => !file));
    return () =>
      valid.forEach((file) => {
        if (file.previewUrl.startsWith("blob:"))
          URL.revokeObjectURL(file.previewUrl);
      });
  }, [files, attachmentUrl]);
  return (
    <Space direction="vertical" size={12} style={{ width: "100%" }}>
      {!previews.length && !invalid && (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="尚未附上原始憑證"
        />
      )}
      {invalid && (
        <Alert
          type="warning"
          showIcon
          message="部分附件無法預覽，請申請人補上有效圖片或 PDF"
        />
      )}
      {previews.map((file, index) => (
        <div
          key={index}
          style={{ padding: 12, border: "1px solid #e2e8f0", borderRadius: 12 }}
        >
          <Typography.Text strong>{file.name}</Typography.Text>
          {file.image && (
            <div style={{ marginTop: 8 }}>
              <Image
                src={file.previewUrl}
                alt={`原始憑證：${file.name}`}
                style={{ maxHeight: 320, objectFit: "contain" }}
              />
            </div>
          )}
          <div style={{ display: "flex", gap: 16, marginTop: 8 }}>
            <a href={file.previewUrl} target="_blank" rel="noopener noreferrer">
              開啟原始憑證
            </a>
            <a
              href={file.previewUrl}
              download={file.name}
              target="_blank"
              rel="noopener noreferrer"
            >
              下載附件
            </a>
          </div>
        </div>
      ))}
    </Space>
  );
}
