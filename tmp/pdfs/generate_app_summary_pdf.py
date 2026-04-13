from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from pathlib import Path

output_path = Path('output/pdf/ecom-accounting-system-one-page-summary.pdf')

PAGE_W, PAGE_H = letter
MARGIN_X = 42
TOP_Y = PAGE_H - 42
BOTTOM_Y = 42

c = canvas.Canvas(str(output_path), pagesize=letter)

# Typography
TITLE_SIZE = 16
HEADING_SIZE = 11
BODY_SIZE = 9
LINE_GAP = 12


def wrap_text(text, font_name, font_size, max_width):
    words = text.split()
    lines = []
    current = ''
    for word in words:
        candidate = f"{current} {word}".strip()
        width = pdfmetrics.stringWidth(candidate, font_name, font_size)
        if width <= max_width or not current:
            current = candidate
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def draw_heading(text, y):
    c.setFont('Helvetica-Bold', HEADING_SIZE)
    c.drawString(MARGIN_X, y, text)
    return y - LINE_GAP


def draw_paragraph(text, y, indent=0, font='Helvetica', size=BODY_SIZE):
    max_width = PAGE_W - (MARGIN_X * 2) - indent
    lines = wrap_text(text, font, size, max_width)
    c.setFont(font, size)
    for line in lines:
        c.drawString(MARGIN_X + indent, y, line)
        y -= LINE_GAP - 1
    return y - 2


def draw_bullet(text, y):
    bullet_indent = 12
    text_indent = 22
    max_width = PAGE_W - (MARGIN_X * 2) - text_indent
    lines = wrap_text(text, 'Helvetica', BODY_SIZE, max_width)
    c.setFont('Helvetica', BODY_SIZE)
    c.drawString(MARGIN_X + bullet_indent, y, '-')
    if lines:
        c.drawString(MARGIN_X + text_indent, y, lines[0])
        y -= LINE_GAP - 1
    for line in lines[1:]:
        c.drawString(MARGIN_X + text_indent, y, line)
        y -= LINE_GAP - 1
    return y - 1


y = TOP_Y
c.setFont('Helvetica-Bold', TITLE_SIZE)
c.drawString(MARGIN_X, y, 'E-Commerce Accounting System - One-Page Summary')
y -= 18
c.setFont('Helvetica', 8)
c.drawString(MARGIN_X, y, 'Evidence base: README.md, backend/src/app.module.ts, backend/src/main.ts, frontend/src/App.tsx, frontend/src/services/*.ts, docker-compose.yml')
y -= 14

# What it is
y = draw_heading('What it is', y)
y = draw_paragraph('A full-stack accounting and operations platform for e-commerce businesses, built with a React frontend and a NestJS backend.', y)
y = draw_paragraph('The repo positions it as multi-entity and multi-currency, combining finance, supply-chain, and workflow modules in one system.', y)

# Who it is for
y = draw_heading('Who it\'s for', y)
y = draw_paragraph('Primary persona: accounting/finance teams and e-commerce operations managers who need one system for bookkeeping, approvals, inventory-linked operations, and reporting.', y)

# What it does
y = draw_heading('What it does', y)
feature_bullets = [
    'Supports multi-entity, multi-currency accounting with standardized amount fields (original amount/currency/rate/base amount).',
    'Covers core finance flows: chart of accounts, AP, AR, expense requests, approvals, banking, payroll, and reports.',
    'Includes supply-chain capabilities: product catalog, inventory, purchase orders, assembly, sales orders, and customer management.',
    'Provides role-based access control with JWT-protected APIs and guarded frontend routes.',
    'Adds AI functions for expense categorization, financial insights, and copilot-style query support.',
    'Includes real-time notifications and attendance-related modules, plus Shopify integration/webhook handling.',
]
for b in feature_bullets:
    y = draw_bullet(b, y)

# How it works
y = draw_heading('How it works (repo-evidenced architecture)', y)
arch_bullets = [
    'Frontend: React 19 + Vite SPA with route-level modules and context providers (auth/theme/AI).',
    'Client data layer: Axios services call /api/v1 (or VITE_API_URL) and attach JWT bearer tokens from localStorage.',
    'Backend: NestJS 11 modular API; main bootstrap sets /api/v1 prefix, validation pipes, CORS, and Swagger at /api-docs.',
    'Domain modules are wired in AppModule (auth, accounting, AP/AR, expense, banking, payroll, reports, inventory/product, purchase, assembly, attendance, notifications, AI, integrations).',
    'Persistence: service/repository pattern backed by PrismaService -> PostgreSQL schema; Redis and queue modules are also initialized.',
    'Realtime path: backend notification gateway emits events consumed by frontend Socket.IO websocket service.',
]
for b in arch_bullets:
    y = draw_bullet(b, y)

# How to run
y = draw_heading('How to run (minimal getting started)', y)
run_steps = [
    'Start data services: docker-compose up -d postgres redis',
    'Backend: cd backend && cp .env.example .env && npm install && npm run prisma:migrate && npm run prisma:seed && npm run start:dev',
    'Frontend: cd frontend && npm install && npm run dev',
    'Open: Frontend http://localhost:5173, API http://localhost:3000/api/v1, Swagger http://localhost:3000/api-docs',
]
for i, step in enumerate(run_steps, start=1):
    y = draw_bullet(f'{i}. {step}', y)

if y < BOTTOM_Y:
    raise RuntimeError(f'Content overflowed single page (final y={y}).')

c.save()
print(str(output_path))
