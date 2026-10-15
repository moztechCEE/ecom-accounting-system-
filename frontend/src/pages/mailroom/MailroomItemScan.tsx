import { useState } from 'react'
import { Input, Typography } from 'antd'
import { ScanOutlined } from '@ant-design/icons'
import { parsePhysicalItemScan } from '../../utils/mailroom-item-link'

export default function MailroomItemScan({ entityId, disabled, onOpen }: {
  entityId: string; disabled?: boolean;
  onOpen: (target: { itemId: string; entityId: string; path: string }) => void;
}) {
  const [value, setValue] = useState(''), [failure, setFailure] = useState('')
  return <div>
    <Input.Search aria-label="掃描物件標籤" prefix={<ScanOutlined />} placeholder="掃描標籤或輸入物件編號" value={value} disabled={disabled} maxLength={600}
      onChange={event => { setValue(event.target.value); setFailure('') }}
      onSearch={() => {
        const target = parsePhysicalItemScan(value, window.location.origin, entityId)
        if (!target) { setFailure('無法辨識此公司的物件標籤'); return }
        setValue(''); setFailure(''); onOpen(target)
      }} />
    {failure && <Typography.Text role="alert" type="danger">{failure}</Typography.Text>}
  </div>
}
