import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { B2bQuoteMailService } from './b2b-quote-mail.service';

jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));

describe('private quote mail transport', () => {
  const env: Record<string, string> = {
    SMTP_HOST: 'smtp.example.test',
    SMTP_PORT: '587',
    SMTP_FROM: 'sales@example.test',
    B2B_PRIVATE_QUOTE_FRONTEND_ORIGIN: 'https://dev.example.test',
  };
  const config = { get: (key: string) => env[key] } as ConfigService;
  const service = new B2bQuoteMailService(config);
  const sendMail = jest
    .fn()
    .mockResolvedValue({ accepted: ['buyer@example.test'] });
  beforeEach(() => {
    Object.assign(env, {
      SMTP_HOST: 'smtp.example.test',
      SMTP_PORT: '587',
      SMTP_FROM: 'sales@example.test',
      B2B_PRIVATE_QUOTE_FRONTEND_ORIGIN: 'https://dev.example.test',
    });
    (nodemailer.createTransport as jest.Mock).mockReturnValue({
      sendMail,
      close: jest.fn(),
    });
    sendMail.mockClear();
  });

  it('puts the opaque token only in a fragment on the configured HTTPS origin', async () => {
    await service.send({
      to: 'buyer@example.test',
      quotationNo: 'QT-1',
      token: 'A'.repeat(43),
      expiresAt: new Date('2026-10-01T00:00:00Z'),
    });
    const message = sendMail.mock.calls[0][0];
    expect(message.text).toContain(
      'https://dev.example.test/b2b/private-quote#token=' + 'A'.repeat(43),
    );
    expect(message.text).not.toContain('?token=');
    expect(message.to).toBe('buyer@example.test');
  });

  it('fails closed for missing SMTP or non-HTTPS origin and rejects unaccepted handoff', async () => {
    delete env.SMTP_HOST;
    expect(() => service.assertConfigured()).toThrow(
      ServiceUnavailableException,
    );
    env.SMTP_HOST = 'smtp.example.test';
    env.B2B_PRIVATE_QUOTE_FRONTEND_ORIGIN = 'http://dev.example.test';
    expect(() => service.assertConfigured()).toThrow(
      ServiceUnavailableException,
    );
    env.B2B_PRIVATE_QUOTE_FRONTEND_ORIGIN = 'https://dev.example.test';
    sendMail.mockResolvedValueOnce({ accepted: [] });
    await expect(
      service.send({
        to: 'buyer@example.test',
        quotationNo: 'QT-1',
        token: 'B'.repeat(43),
        expiresAt: new Date('2026-10-01T00:00:00Z'),
      }),
    ).rejects.toThrow(ServiceUnavailableException);
  });
});
