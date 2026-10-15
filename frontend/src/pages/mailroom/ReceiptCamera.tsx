import { useEffect, useRef, useState } from 'react'
import { Button, Modal, Typography } from 'antd'
import { CameraOutlined } from '@ant-design/icons'

export default function ReceiptCamera({ open, onCancel, onCapture }: {
  open: boolean; onCancel: () => void; onCapture: (file: File) => Promise<boolean>;
}) {
  const video = useRef<HTMLVideoElement>(null), stream = useRef<MediaStream | null>(null)
  const [ready, setReady] = useState(false), [capturing, setCapturing] = useState(false), [failure, setFailure] = useState('')
  useEffect(() => {
    if (!open) return
    let active = true
    setReady(false); setFailure('')
    const stop = () => { stream.current?.getTracks().forEach(track => track.stop()); stream.current = null; if (video.current) video.current.srcObject = null }
    const visibility = () => { if (document.hidden) { stop(); onCancel() } }
    document.addEventListener('visibilitychange', visibility)
    void navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1600 }, height: { ideal: 1200 } } })
      .then(async result => {
        if (!active) { result.getTracks().forEach(track => track.stop()); return }
        stream.current = result
        if (video.current) { video.current.srcObject = result; await video.current.play() }
      }).catch(error => {
        if (!active) return
        stop()
        setFailure(error?.name === 'NotAllowedError' ? '未取得相機權限，請允許相機或從相簿加入照片' : '無法開啟相機，請確認相機可用或從相簿加入照片')
      })
    return () => { active = false; stop(); document.removeEventListener('visibilitychange', visibility) }
  }, [open, onCancel])
  async function capture() {
    const source = video.current
    if (!source?.videoWidth || !source.videoHeight || capturing) return
    setCapturing(true); setFailure('')
    const canvas = document.createElement('canvas'), scale = Math.min(1, 1600 / Math.max(source.videoWidth, source.videoHeight))
    canvas.width = Math.max(1, Math.round(source.videoWidth * scale)); canvas.height = Math.max(1, Math.round(source.videoHeight * scale))
    try {
      const context = canvas.getContext('2d')
      if (!context) throw new Error('此裝置無法處理照片')
      context.drawImage(source, 0, 0, canvas.width, canvas.height)
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('拍照失敗，請重試')), 'image/jpeg', 0.85))
      if (await onCapture(new File([blob], 'receipt-camera.jpg', { type: 'image/jpeg' }))) onCancel()
      else setFailure('照片未加入，請確認照片數量與大小後再試')
    } catch (error) { setFailure(error instanceof Error ? error.message : '拍照失敗，請重試') }
    finally { canvas.width = 0; canvas.height = 0; setCapturing(false) }
  }
  return <Modal title="拍照" open={open} onCancel={onCancel} destroyOnHidden footer={[
    <Button key="cancel" onClick={onCancel} disabled={capturing}>取消</Button>,
    <Button key="capture" type="primary" icon={<CameraOutlined />} disabled={!ready} loading={capturing} onClick={() => void capture()}>拍攝</Button>,
  ]}>
    <video ref={video} autoPlay playsInline muted aria-label="相機預覽" onLoadedData={() => setReady(true)} style={{ width: '100%', maxHeight: '60vh', background: '#18212b', objectFit: 'contain', borderRadius: 8 }} />
    {failure && <Typography.Text role="alert" type="danger">{failure}</Typography.Text>}
  </Modal>
}
