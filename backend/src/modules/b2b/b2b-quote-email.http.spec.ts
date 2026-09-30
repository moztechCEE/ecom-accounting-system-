import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { B2bPrivateQuoteController } from './b2b.controller';
import { B2bService } from './b2b.service';

describe('private quote public HTTP contract', () => {
  let app: INestApplication;
  const service = {
    previewEmailQuote: jest.fn().mockResolvedValue({ status: 'sent' }),
    acceptEmailQuote: jest.fn().mockResolvedValue({ status: 'accepted' }),
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [B2bPrivateQuoteController],
      providers: [{ provide: B2bService, useValue: service }],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });

  it('uses POST bodies and prevents cache, referrer, and search indexing', async () => {
    const token = 'A'.repeat(43);
    const preview = await request(app.getHttpServer())
      .post('/b2b/public/quote-access/preview')
      .send({ token })
      .expect(201);
    expect(preview.headers['cache-control']).toBe('no-store');
    expect(preview.headers['referrer-policy']).toBe('no-referrer');
    expect(preview.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(service.previewEmailQuote).toHaveBeenCalledWith({ token });
    const accepted = await request(app.getHttpServer())
      .post('/b2b/public/quote-access/accept')
      .send({ token })
      .expect(201);
    expect(accepted.headers['cache-control']).toBe('no-store');
    expect(accepted.headers['referrer-policy']).toBe('no-referrer');
    expect(service.acceptEmailQuote).toHaveBeenCalledWith({ token });
  });

  it('rejects malformed secrets and unknown request fields', async () => {
    await request(app.getHttpServer())
      .post('/b2b/public/quote-access/preview')
      .send({ token: 'short' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/b2b/public/quote-access/accept')
      .send({ token: 'A'.repeat(43), recipientEmail: 'untrusted@example.test' })
      .expect(400);
    expect(service.acceptEmailQuote).toHaveBeenCalledTimes(1);
  });
});
