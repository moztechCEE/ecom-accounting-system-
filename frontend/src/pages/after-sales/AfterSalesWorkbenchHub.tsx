import { Alert, Button, Typography } from 'antd'
import { ArrowLeftOutlined, ArrowRightOutlined, FolderOpenOutlined } from '@ant-design/icons'
import type { User } from '../../types'
import {
  afterSalesCaseEntries,
  afterSalesSectionDetails,
  afterSalesSupportEntries,
  canOpenAfterSalesSection,
} from './workbench-model'
import './AfterSalesWorkbenchHub.css'

type Props = { user: User | null; section: string; onOpen: (section: string) => void }
const { Title } = Typography

export default function AfterSalesWorkbenchHub({ user, section, onOpen }: Props) {
  const details = afterSalesSectionDetails(section)
  const home = section === 'workbench'
  const open = (destination: string) => {
    if (canOpenAfterSalesSection(user, destination)) onOpen(destination)
  }

  if (!details) return <Alert type="warning" showIcon message="此售後功能不存在" />
  if (!canOpenAfterSalesSection(user, section)) {
    return <Alert type="warning" showIcon message="目前帳號沒有此售後功能權限" />
  }

  return <section className="after-sales-hub" aria-labelledby="after-sales-hub-title">
    <header className="after-sales-hub-heading">
      <div>
        <Title level={2} id="after-sales-hub-title" className="after-sales-hub-title">{details.title}</Title>
      </div>
      {home
        ? <Button type="primary" size="large" icon={<FolderOpenOutlined />} onClick={() => open('cases')}>案件總覽</Button>
        : canOpenAfterSalesSection(user, 'workbench') && <Button icon={<ArrowLeftOutlined />} onClick={() => open('workbench')}>返回售後工作台</Button>}
    </header>

    {home && <>
      <ul className="after-sales-hub-entries" aria-label="售後案件服務">
        {afterSalesCaseEntries(user).map(entry => <li key={entry.section}>
          <button type="button" className="after-sales-hub-entry" onClick={() => open(entry.section)}>
            <span className="after-sales-hub-entry-copy">
              <span className="after-sales-hub-entry-title">{entry.title}</span>
            </span>
            <ArrowRightOutlined aria-hidden />
          </button>
        </li>)}
      </ul>
      <nav className="after-sales-hub-support" aria-label="售後相關作業">
        {afterSalesSupportEntries(user).map(entry => <Button key={entry.section} type="link" onClick={() => open(entry.section)}>{entry.title}</Button>)}
      </nav>
    </>}
  </section>
}
