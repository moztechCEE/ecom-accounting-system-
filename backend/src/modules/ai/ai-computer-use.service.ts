import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import type {
  ResponseComputerToolCall,
  ResponseInputItem,
} from 'openai/resources/responses/responses';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { randomUUID } from 'crypto';
import { CreateComputerUseSessionDto } from './dto/create-computer-use-session.dto';
import { RunComputerUseTaskDto } from './dto/run-computer-use-task.dto';

interface SessionViewport {
  width: number;
  height: number;
}

interface BrowserConsoleEntry {
  timestamp: string;
  type: string;
  text: string;
  url?: string;
  lineNumber?: number;
  columnNumber?: number;
}

interface BrowserPageError {
  timestamp: string;
  message: string;
  stack?: string;
}

interface BrowserActionLogEntry {
  timestamp: string;
  type: string;
  detail: string;
}

interface ComputerUseSessionState {
  id: string;
  ownerUserId: string;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  createdAt: string;
  updatedAt: string;
  headless: boolean;
  viewport: SessionViewport;
  allowedDomains: string[];
  consoleEntries: BrowserConsoleEntry[];
  pageErrors: BrowserPageError[];
  actionLog: BrowserActionLogEntry[];
}

export interface ComputerUseSessionSnapshot {
  id: string;
  createdAt: string;
  updatedAt: string;
  url: string;
  title: string;
  headless: boolean;
  viewport: SessionViewport;
  allowedDomains: string[];
  screenshotDataUrl: string;
  consoleEntries: BrowserConsoleEntry[];
  pageErrors: BrowserPageError[];
  actionLog: BrowserActionLogEntry[];
}

export interface ComputerUseRunResult {
  model: string;
  responseId: string;
  steps: number;
  actionCount: number;
  finalMessage: string;
  session: ComputerUseSessionSnapshot;
}

const DEFAULT_MODEL = 'gpt-5.5';
const DEFAULT_VIEWPORT_WIDTH = 1440;
const DEFAULT_VIEWPORT_HEIGHT = 900;
const DEFAULT_MAX_STEPS = 12;
const MAX_LOG_ENTRIES = 100;

@Injectable()
export class AiComputerUseService implements OnModuleDestroy {
  private readonly logger = new Logger(AiComputerUseService.name);
  private readonly client: OpenAI | null;
  private readonly sessions = new Map<string, ComputerUseSessionState>();
  private readonly defaultModel: string;
  private readonly defaultHeadless: boolean;
  private readonly defaultMaxSteps: number;
  private readonly defaultAllowedDomains: string[];

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY')?.trim() || '';
    this.defaultModel =
      this.configService.get<string>('OPENAI_COMPUTER_USE_MODEL')?.trim() ||
      DEFAULT_MODEL;
    this.defaultHeadless =
      this.configService.get<string>('OPENAI_COMPUTER_USE_HEADLESS') !==
      'false';
    this.defaultMaxSteps = Math.max(
      1,
      Number.parseInt(
        this.configService.get<string>('OPENAI_COMPUTER_USE_MAX_STEPS') ||
          `${DEFAULT_MAX_STEPS}`,
        10,
      ) || DEFAULT_MAX_STEPS,
    );
    this.defaultAllowedDomains = (
      this.configService.get<string>('OPENAI_COMPUTER_USE_ALLOWED_DOMAINS') ||
      ''
    )
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);

    if (!apiKey) {
      this.logger.warn(
        'OPENAI_API_KEY is not set. Computer use features will be disabled.',
      );
      this.client = null;
      return;
    }

    this.client = new OpenAI({ apiKey });
  }

  async onModuleDestroy() {
    for (const session of this.sessions.values()) {
      await this.closeSessionResources(session);
    }
    this.sessions.clear();
  }

  async createSession(
    ownerUserId: string,
    dto: CreateComputerUseSessionDto,
  ): Promise<ComputerUseSessionSnapshot> {
    this.ensureClient();

    const viewport = {
      width: dto.viewportWidth ?? DEFAULT_VIEWPORT_WIDTH,
      height: dto.viewportHeight ?? DEFAULT_VIEWPORT_HEIGHT,
    };
    const allowedDomains = this.mergeAllowedDomains(dto.allowedDomains);
    const browser = await chromium.launch({
      headless: dto.headless ?? this.defaultHeadless,
      args: ['--disable-dev-shm-usage', '--no-sandbox'],
    });
    const context = await browser.newContext({
      viewport,
      ignoreHTTPSErrors: true,
    });
    const page = await context.newPage();

    const session: ComputerUseSessionState = {
      id: randomUUID(),
      ownerUserId,
      browser,
      context,
      page,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      headless: dto.headless ?? this.defaultHeadless,
      viewport,
      allowedDomains,
      consoleEntries: [],
      pageErrors: [],
      actionLog: [],
    };

    this.attachSessionListeners(session);

    try {
      if (dto.startUrl) {
        await this.navigateToUrl(session, dto.startUrl);
      }

      this.sessions.set(session.id, session);
      return this.buildSnapshot(session);
    } catch (error) {
      await this.closeSessionResources(session);
      throw error;
    }
  }

  async listSessions(ownerUserId: string): Promise<ComputerUseSessionSnapshot[]> {
    const sessions = Array.from(this.sessions.values()).filter(
      (session) => session.ownerUserId === ownerUserId,
    );
    return Promise.all(sessions.map((session) => this.buildSnapshot(session)));
  }

  async getSession(
    ownerUserId: string,
    sessionId: string,
  ): Promise<ComputerUseSessionSnapshot> {
    const session = this.getOwnedSessionOrThrow(ownerUserId, sessionId);
    return this.buildSnapshot(session);
  }

  async navigateSession(
    ownerUserId: string,
    sessionId: string,
    url: string,
  ): Promise<ComputerUseSessionSnapshot> {
    const session = this.getOwnedSessionOrThrow(ownerUserId, sessionId);
    await this.navigateToUrl(session, url);
    return this.buildSnapshot(session);
  }

  async runTask(
    ownerUserId: string,
    sessionId: string,
    dto: RunComputerUseTaskDto,
  ): Promise<ComputerUseRunResult> {
    const session = this.getOwnedSessionOrThrow(ownerUserId, sessionId);
    const client = this.ensureClient();

    if (!dto.task.trim()) {
      throw new BadRequestException('task 不可為空');
    }

    if (dto.allowedDomains?.length) {
      session.allowedDomains = this.mergeAllowedDomains(dto.allowedDomains);
      this.touchSession(session);
    }

    if (dto.startUrl) {
      await this.navigateToUrl(session, dto.startUrl);
    }

    const model = dto.model?.trim() || this.defaultModel;
    const maxSteps = Math.min(
      30,
      Math.max(1, dto.maxSteps ?? this.defaultMaxSteps),
    );

    let response = await client.responses.create({
      model,
      tools: [{ type: 'computer' }],
      instructions: [
        'You are a browser debugging assistant inside an ERP system.',
        'Inspect the current page, reproduce issues carefully, and explain what you observe.',
        'Never attempt purchases, payments, destructive deletes, or irreversible submissions.',
        'If login is required and credentials are missing, stop and explain what access is needed.',
        'Work step-by-step and stop once you can clearly answer the debugging request.',
      ].join(' '),
      input: dto.task.trim(),
    });

    let steps = 0;
    let actionCount = 0;
    let hasPendingComputerCalls = false;

    while (steps < maxSteps) {
      const computerCalls = response.output.filter(
        (item): item is ResponseComputerToolCall => item.type === 'computer_call',
      );

      if (!computerCalls.length) {
        hasPendingComputerCalls = false;
        break;
      }

      hasPendingComputerCalls = true;
      steps += 1;

      const outputs: ResponseInputItem[] = [];

      for (const computerCall of computerCalls) {
        const actions =
          computerCall.actions && computerCall.actions.length
            ? computerCall.actions
            : computerCall.action
              ? [computerCall.action]
              : [{ type: 'screenshot' as const }];

        await this.executeActions(session, actions);
        actionCount += actions.length;
        this.ensurePageUrlAllowed(session);

        outputs.push({
          type: 'computer_call_output',
          call_id: computerCall.call_id,
          acknowledged_safety_checks: computerCall.pending_safety_checks ?? [],
          output: {
            type: 'computer_screenshot',
            image_url: await this.captureScreenshotDataUrl(session),
          },
        });
      }

      response = await client.responses.create({
        model,
        previous_response_id: response.id,
        tools: [{ type: 'computer' }],
        input: outputs,
      });
    }

    const finalMessage = response.output_text?.trim()
      ? hasPendingComputerCalls && steps >= maxSteps
        ? `${response.output_text.trim()}\n\n已達到本次最大操作步數，若要繼續可再送一次 run。`
        : response.output_text.trim()
      : hasPendingComputerCalls && steps >= maxSteps
        ? '已達到本次最大操作步數，請再執行一次 run 繼續。'
        : '模型已完成操作，但沒有輸出最終文字說明。';

    return {
      model,
      responseId: response.id,
      steps,
      actionCount,
      finalMessage,
      session: await this.buildSnapshot(session),
    };
  }

  async closeSession(ownerUserId: string, sessionId: string) {
    const session = this.getOwnedSessionOrThrow(ownerUserId, sessionId);
    await this.closeSessionResources(session);
    this.sessions.delete(sessionId);
    return { success: true };
  }

  private ensureClient(): OpenAI {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'OPENAI_API_KEY 尚未設定，computer use 功能目前不可用。',
      );
    }

    return this.client;
  }

  private getOwnedSessionOrThrow(
    ownerUserId: string,
    sessionId: string,
  ): ComputerUseSessionState {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new NotFoundException(`找不到 computer use session: ${sessionId}`);
    }

    if (session.ownerUserId !== ownerUserId) {
      throw new ForbiddenException('你沒有權限操作這個 computer use session。');
    }

    return session;
  }

  private mergeAllowedDomains(allowedDomains?: string[]): string[] {
    const merged = [
      ...this.defaultAllowedDomains,
      ...(allowedDomains || []).map((value) => value.trim().toLowerCase()),
    ].filter(Boolean);
    return Array.from(new Set(merged));
  }

  private attachSessionListeners(session: ComputerUseSessionState) {
    session.page.on('console', (message) => {
      const location = message.location();
      this.pushEntry(session.consoleEntries, {
        timestamp: new Date().toISOString(),
        type: message.type(),
        text: message.text(),
        url: location.url,
        lineNumber: location.lineNumber,
        columnNumber: location.columnNumber,
      });
      this.touchSession(session);
    });

    session.page.on('pageerror', (error) => {
      this.pushEntry(session.pageErrors, {
        timestamp: new Date().toISOString(),
        message: error.message,
        stack: error.stack,
      });
      this.touchSession(session);
    });
  }

  private async navigateToUrl(
    session: ComputerUseSessionState,
    url: string,
  ): Promise<void> {
    this.ensureUrlAllowed(session.allowedDomains, url);
    await session.page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    this.recordAction(session, 'goto', url);
    this.touchSession(session);
  }

  private ensurePageUrlAllowed(session: ComputerUseSessionState) {
    const currentUrl = session.page.url();
    if (!currentUrl || currentUrl === 'about:blank') {
      return;
    }
    this.ensureUrlAllowed(session.allowedDomains, currentUrl);
  }

  private ensureUrlAllowed(allowedDomains: string[], url: string) {
    if (!allowedDomains.length) {
      return;
    }

    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    const isAllowed = allowedDomains.some((domain) => {
      const normalized = domain.replace(/^\*\./, '').toLowerCase();
      return hostname === normalized || hostname.endsWith(`.${normalized}`);
    });

    if (!isAllowed) {
      throw new ForbiddenException(
        `目前 computer use session 不允許操作網域 ${hostname}。`,
      );
    }
  }

  private async executeActions(
    session: ComputerUseSessionState,
    actions: Array<ResponseComputerToolCall['action']>,
  ) {
    for (const action of actions) {
      if (!action) {
        continue;
      }

      switch (action.type) {
        case 'click':
          await session.page.mouse.click(action.x, action.y, {
            button: this.normalizeMouseButton(action.button),
          });
          this.recordAction(
            session,
            'click',
            `${action.button} (${action.x}, ${action.y})`,
          );
          break;
        case 'double_click':
          await session.page.mouse.dblclick(action.x, action.y);
          this.recordAction(
            session,
            'double_click',
            `(${action.x}, ${action.y})`,
          );
          break;
        case 'move':
          await session.page.mouse.move(action.x, action.y);
          this.recordAction(session, 'move', `(${action.x}, ${action.y})`);
          break;
        case 'drag': {
          const [firstPoint, ...rest] = action.path;
          if (!firstPoint) {
            break;
          }
          await session.page.mouse.move(firstPoint.x, firstPoint.y);
          await session.page.mouse.down();
          for (const point of rest) {
            await session.page.mouse.move(point.x, point.y, { steps: 8 });
          }
          await session.page.mouse.up();
          this.recordAction(session, 'drag', `${action.path.length} points`);
          break;
        }
        case 'scroll':
          await session.page.mouse.move(action.x, action.y);
          await session.page.mouse.wheel(action.scroll_x, action.scroll_y);
          this.recordAction(
            session,
            'scroll',
            `dx=${action.scroll_x}, dy=${action.scroll_y}`,
          );
          break;
        case 'keypress':
          await this.pressKeys(session.page, action.keys);
          this.recordAction(session, 'keypress', action.keys.join(' + '));
          break;
        case 'type':
          await session.page.keyboard.type(action.text);
          this.recordAction(
            session,
            'type',
            action.text.length > 80
              ? `${action.text.slice(0, 77)}...`
              : action.text,
          );
          break;
        case 'wait':
          await session.page.waitForTimeout(1000);
          this.recordAction(session, 'wait', '1000ms');
          break;
        case 'screenshot':
          this.recordAction(session, 'screenshot', 'captured');
          break;
        default:
          this.logger.warn(`Unsupported computer action: ${(action as any).type}`);
      }

      this.touchSession(session);
    }
  }

  private async pressKeys(page: Page, keys: string[]) {
    const normalizedKeys = keys.map((key) => this.normalizeKey(key));
    const pressedModifiers = normalizedKeys.slice(0, -1);
    const finalKey = normalizedKeys[normalizedKeys.length - 1];

    for (const key of pressedModifiers) {
      await page.keyboard.down(key);
    }

    if (finalKey) {
      await page.keyboard.press(finalKey);
    }

    for (const key of pressedModifiers.reverse()) {
      await page.keyboard.up(key);
    }
  }

  private normalizeKey(key: string): string {
    const normalized = key.trim().toLowerCase();
    const mapping: Record<string, string> = {
      ctrl: 'Control',
      control: 'Control',
      cmd: 'Meta',
      command: 'Meta',
      meta: 'Meta',
      option: 'Alt',
      alt: 'Alt',
      shift: 'Shift',
      enter: 'Enter',
      return: 'Enter',
      esc: 'Escape',
      escape: 'Escape',
      backspace: 'Backspace',
      delete: 'Delete',
      del: 'Delete',
      tab: 'Tab',
      space: 'Space',
      up: 'ArrowUp',
      down: 'ArrowDown',
      left: 'ArrowLeft',
      right: 'ArrowRight',
      pageup: 'PageUp',
      pagedown: 'PageDown',
      home: 'Home',
      end: 'End',
    };

    if (mapping[normalized]) {
      return mapping[normalized];
    }

    if (normalized.length === 1) {
      return normalized.toUpperCase();
    }

    return key;
  }

  private normalizeMouseButton(
    button: ResponseComputerToolCall.Click['button'],
  ): 'left' | 'right' | 'middle' {
    switch (button) {
      case 'right':
        return 'right';
      case 'wheel':
        return 'middle';
      case 'back':
      case 'forward':
      case 'left':
      default:
        return 'left';
    }
  }

  private async buildSnapshot(
    session: ComputerUseSessionState,
  ): Promise<ComputerUseSessionSnapshot> {
    return {
      id: session.id,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      url: session.page.url(),
      title: await session.page.title(),
      headless: session.headless,
      viewport: session.viewport,
      allowedDomains: session.allowedDomains,
      screenshotDataUrl: await this.captureScreenshotDataUrl(session),
      consoleEntries: [...session.consoleEntries],
      pageErrors: [...session.pageErrors],
      actionLog: [...session.actionLog],
    };
  }

  private async captureScreenshotDataUrl(
    session: ComputerUseSessionState,
  ): Promise<string> {
    const screenshot = await session.page.screenshot({
      type: 'png',
      fullPage: false,
    });
    return `data:image/png;base64,${screenshot.toString('base64')}`;
  }

  private pushEntry<T>(collection: T[], entry: T) {
    collection.push(entry);
    if (collection.length > MAX_LOG_ENTRIES) {
      collection.splice(0, collection.length - MAX_LOG_ENTRIES);
    }
  }

  private recordAction(
    session: ComputerUseSessionState,
    type: string,
    detail: string,
  ) {
    this.pushEntry(session.actionLog, {
      timestamp: new Date().toISOString(),
      type,
      detail,
    });
  }

  private touchSession(session: ComputerUseSessionState) {
    session.updatedAt = new Date().toISOString();
  }

  private async closeSessionResources(session: ComputerUseSessionState) {
    await session.context.close().catch(() => undefined);
    await session.browser.close().catch(() => undefined);
  }
}
