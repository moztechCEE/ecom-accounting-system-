from pathlib import Path
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

output_path = Path('output/pdf/ecom-accounting-system-one-page-summary-zh-tw.pdf')
output_path.parent.mkdir(parents=True, exist_ok=True)

PAGE_W, PAGE_H = letter
MARGIN_X = 40
TOP_Y = PAGE_H - 40
BOTTOM_Y = 40

FONT_PATH = '/Library/Fonts/Arial Unicode.ttf'
FONT_MAIN = 'ArialUnicode'
pdfmetrics.registerFont(TTFont(FONT_MAIN, FONT_PATH))

TITLE_SIZE = 15
HEADING_SIZE = 10.5
BODY_SIZE = 8.6
LINE_GAP = 11.2


def wrap_text(text, font_name, font_size, max_width):
    lines = []
    current = ''
    for ch in text:
        candidate = current + ch
        if pdfmetrics.stringWidth(candidate, font_name, font_size) <= max_width or not current:
            current = candidate
        else:
            lines.append(current)
            current = ch
    if current:
        lines.append(current)
    return lines


def draw_heading(c, text, y):
    c.setFont(FONT_MAIN, HEADING_SIZE)
    c.drawString(MARGIN_X, y, text)
    return y - LINE_GAP


def draw_paragraph(c, text, y, indent=0, size=BODY_SIZE):
    max_width = PAGE_W - (MARGIN_X * 2) - indent
    lines = wrap_text(text, FONT_MAIN, size, max_width)
    c.setFont(FONT_MAIN, size)
    for line in lines:
        c.drawString(MARGIN_X + indent, y, line)
        y -= LINE_GAP - 1
    return y - 1.5


def draw_bullet(c, text, y):
    bullet_indent = 11
    text_indent = 20
    max_width = PAGE_W - (MARGIN_X * 2) - text_indent
    lines = wrap_text(text, FONT_MAIN, BODY_SIZE, max_width)
    c.setFont(FONT_MAIN, BODY_SIZE)
    c.drawString(MARGIN_X + bullet_indent, y, '-')
    if lines:
        c.drawString(MARGIN_X + text_indent, y, lines[0])
        y -= LINE_GAP - 1
    for line in lines[1:]:
        c.drawString(MARGIN_X + text_indent, y, line)
        y -= LINE_GAP - 1
    return y - 0.5


c = canvas.Canvas(str(output_path), pagesize=letter)
y = TOP_Y

c.setFont(FONT_MAIN, TITLE_SIZE)
c.drawString(MARGIN_X, y, '電商會計系統 - 單頁摘要（繁體中文版）')
y -= 16
c.setFont(FONT_MAIN, 7.2)
c.drawString(
    MARGIN_X,
    y,
    '證據來源：README.md、backend/src/app.module.ts、backend/src/main.ts、frontend/src/App.tsx、frontend/src/services/*.ts、docker-compose.yml'
)
y -= 12

# What it is
y = draw_heading(c, '這是什麼', y)
y = draw_paragraph(c, '這是一套給電商企業使用的全端會計與營運管理系統，前端採 React + Vite，後端採 NestJS。', y)
y = draw_paragraph(c, '依 repo 說明與程式碼，它整合多實體、多幣別財務流程，並串接供應鏈與審批作業。', y)

# Who it's for
y = draw_heading(c, '適用對象', y)
y = draw_paragraph(c, '主要使用者為財會人員與電商營運管理者，需要在同一系統處理帳務、審批、庫存關聯流程與報表。', y)

# What it does
y = draw_heading(c, '它做什麼（重點功能）', y)
features = [
    '支援多公司實體與多幣別金額欄位標準（原幣金額、幣別、匯率、本位幣金額）。',
    '涵蓋核心財務模組：會計科目、AP、AR、費用申請、審批、銀行、薪資、報表。',
    '涵蓋供應鏈作業：產品與庫存、採購單、組裝單、銷售訂單、客戶管理。',
    '提供 RBAC 與 JWT 驗證；前後端都有受保護路由與權限控管。',
    '提供 AI 功能：費用分類建議、儀表板洞察、Copilot 查詢互動。',
    '支援即時通知（WebSocket）與 Shopify 整合（含 webhook 驗證流程）。',
]
for item in features:
    y = draw_bullet(c, item, y)

# How it works
y = draw_heading(c, '如何運作（僅依 repo 證據）', y)
architecture = [
    '前端：React SPA（路由模組化）+ Auth/Theme/AI Context。',
    '資料呼叫：Axios service 走 /api/v1（或 VITE_API_URL），請求自動附帶 Bearer Token。',
    '後端：NestJS 模組化架構；啟動時設定全域驗證管線、CORS、API 前綴、Swagger。',
    '資料層：Service + Repository 搭配 Prisma 連 PostgreSQL；Redis 與 Queue 模組在 AppModule 初始化。',
    '即時資料流：後端通知 gateway 推送事件，前端以 Socket.IO 訂閱通知。',
]
for item in architecture:
    y = draw_bullet(c, item, y)

# How to run
y = draw_heading(c, '如何執行（最小起步）', y)
run_steps = [
    '啟動資料服務：docker-compose up -d postgres redis',
    '啟動後端：cd backend && cp .env.example .env && npm install && npm run prisma:migrate && npm run prisma:seed && npm run start:dev',
    '啟動前端：cd frontend && npm install && npm run dev',
    '開啟服務：Frontend http://localhost:5173、API http://localhost:3000/api/v1、Swagger http://localhost:3000/api-docs',
]
for i, step in enumerate(run_steps, 1):
    y = draw_bullet(c, f'{i}. {step}', y)

if y < BOTTOM_Y:
    raise RuntimeError(f'內容超出單頁，final y={y}')

c.save()
print(output_path)
