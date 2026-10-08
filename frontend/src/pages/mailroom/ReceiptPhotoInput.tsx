import { useEffect, useRef, useState } from "react";
import { Button, Image, Space, Typography, Upload } from "antd";
import { CameraOutlined, DeleteOutlined } from "@ant-design/icons";

import { ITEM_PHOTO_LIMIT, photoBytes, prepareReceiptPhoto } from "./receipt-photos";
export default function ReceiptPhotoInput({ value = [], onChange, disabled, onBusyChange }: {
  value?: string[]; onChange?: (value: string[]) => void; disabled?: boolean; onBusyChange?: (busy: boolean) => void;
}) {
  const [failure, setFailure] = useState("");
  const [reading, setReading] = useState(false);
  const generation = useRef(0), current = useRef(value), pending = useRef(false);
  useEffect(() => { current.current = value; }, [value]);
  useEffect(() => () => { generation.current++; }, []);
  async function add(file: File) {
    if (disabled || pending.current) return false;
    setFailure("");
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) { setFailure("請使用 JPG、PNG 或 WebP 照片"); return false; }
    if (current.current.length >= 4) {
      setFailure("每件最多 4 張照片，合計不可超過 3 MB"); return false;
    }
    const id = ++generation.current;
    pending.current = true; setReading(true); onBusyChange?.(true);
    try {
      const prepared = await prepareReceiptPhoto(file);
      if (generation.current !== id) return false;
      if (current.current.reduce((sum, photo) => sum + photoBytes(photo), 0) + prepared.size > ITEM_PHOTO_LIMIT) throw new Error("每件照片合計不可超過 3 MB");
      const photo = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("照片讀取失敗")); reader.readAsDataURL(prepared);
      });
      if (generation.current !== id) return false;
      const next = [...current.current, photo]; current.current = next; onChange?.(next);
    } catch (error) { if (generation.current === id) setFailure(error instanceof Error ? error.message : "照片讀取失敗，請重試"); }
    finally { if (generation.current === id) { pending.current = false; setReading(false); onBusyChange?.(false); } }
    return false;
  }
  return <div className="mailroom-receipt-photos">
    <Space wrap>
      <Image.PreviewGroup>{value.map((photo, index) => <div className="mailroom-photo-tile" key={`${index}:${photo}`}>
        <Image src={photo} width={88} height={88} style={{ objectFit: "cover" }} alt={`實收照片 ${index + 1}`} />
        <Button type="text" size="small" disabled={disabled || reading} aria-label={`移除實收照片 ${index + 1}`} icon={<DeleteOutlined />} onClick={() => onChange?.(value.filter((_, i) => i !== index))} />
      </div>)}</Image.PreviewGroup>
      <Upload accept="image/jpeg,image/png,image/webp" capture="environment" showUploadList={false} beforeUpload={file => add(file)} disabled={disabled || reading || value.length >= 4}>
        <Button icon={<CameraOutlined />} loading={reading} disabled={disabled || reading || value.length >= 4}>拍照／選擇照片</Button>
      </Upload>
    </Space>
    {failure && <div role="alert"><Typography.Text type="danger">{failure}</Typography.Text></div>}
  </div>;
}
