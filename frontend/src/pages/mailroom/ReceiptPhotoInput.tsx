import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Image, Space, Typography } from "antd";
import { CameraOutlined, DeleteOutlined } from "@ant-design/icons";

import { ITEM_PHOTO_LIMIT, photoBytes, prepareReceiptPhoto } from "./receipt-photos";
import ReceiptCamera from "./ReceiptCamera";
export default function ReceiptPhotoInput({ value = [], onChange, disabled, onBusyChange, photoLabel = "實收照片" }: {
  value?: string[]; onChange?: (value: string[]) => void; disabled?: boolean; onBusyChange?: (busy: boolean) => void; photoLabel?: string;
}) {
  const [failure, setFailure] = useState("");
  const [reading, setReading] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const album = useRef<HTMLInputElement>(null), nativeCamera = useRef<HTMLInputElement>(null), busyCallback = useRef(onBusyChange);
  busyCallback.current = onBusyChange;
  const generation = useRef(0), current = useRef(value), pending = useRef(false);
  useEffect(() => { current.current = value; }, [value]);
  useEffect(() => { busyCallback.current?.(reading || cameraOpen); }, [reading, cameraOpen]);
  useEffect(() => () => { generation.current++; busyCallback.current?.(false); }, []);
  useEffect(() => { if (disabled) setCameraOpen(false); }, [disabled]);
  const closeCamera = useCallback(() => setCameraOpen(false), []);
  async function add(file: File) {
    if (disabled || pending.current) return false;
    setFailure("");
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) { setFailure("請使用 JPG、PNG 或 WebP 照片"); return false; }
    if (current.current.length >= 4) {
      setFailure("每件最多 4 張照片，合計不可超過 3 MB"); return false;
    }
    const id = ++generation.current;
    pending.current = true; setReading(true);
    let success = false;
    try {
      const prepared = await prepareReceiptPhoto(file);
      if (generation.current !== id) return false;
      if (current.current.reduce((sum, photo) => sum + photoBytes(photo), 0) + prepared.size > ITEM_PHOTO_LIMIT) throw new Error("每件照片合計不可超過 3 MB");
      const photo = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("照片讀取失敗")); reader.readAsDataURL(prepared);
      });
      if (generation.current !== id) return false;
      const next = [...current.current, photo]; current.current = next; onChange?.(next); success = true;
    } catch (error) { if (generation.current === id) setFailure(error instanceof Error ? error.message : "照片讀取失敗，請重試"); }
    finally { if (generation.current === id) { pending.current = false; setReading(false); } }
    return success;
  }
  return <div className="mailroom-receipt-photos">
    <Space wrap>
      <Image.PreviewGroup>{value.map((photo, index) => <div className="mailroom-photo-tile" key={`${index}:${photo}`}>
        <Image src={photo} width={88} height={88} style={{ objectFit: "cover" }} alt={`${photoLabel} ${index + 1}`} />
        <Button type="text" size="small" disabled={disabled || reading || cameraOpen} aria-label={`移除${photoLabel} ${index + 1}`} icon={<DeleteOutlined />} onClick={() => onChange?.(value.filter((_, i) => i !== index))} />
      </div>)}</Image.PreviewGroup>
      <Button icon={<CameraOutlined />} aria-label={`拍攝${photoLabel}`} loading={reading} disabled={disabled || reading || cameraOpen || value.length >= 4} onClick={() => {
        setFailure("");
        if (typeof navigator.mediaDevices?.getUserMedia === "function") setCameraOpen(true);
        else nativeCamera.current?.click();
      }}>拍照</Button>
      <Button type="text" disabled={disabled || reading || cameraOpen || value.length >= 4} onClick={() => album.current?.click()}>從相簿加入</Button>
      <input ref={album} type="file" aria-label={`加入${photoLabel}`} accept="image/jpeg,image/png,image/webp" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void add(file); event.target.value = ""; }} />
      <input ref={nativeCamera} type="file" aria-label={`使用裝置相機拍攝${photoLabel}`} accept="image/jpeg,image/png,image/webp" capture="environment" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void add(file); event.target.value = ""; }} />
    </Space>
    {failure && <div role="alert"><Typography.Text type="danger">{failure}</Typography.Text></div>}
    <ReceiptCamera open={cameraOpen} onCancel={closeCamera} onCapture={add} />
  </div>;
}
