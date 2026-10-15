import { Type, ValidationPipe } from '@nestjs/common';
import { CreateProductDto, UpdateProductDto } from './dto/create-product.dto';
import { ProductController } from './product.controller';
import { containsCostInput } from './sensitive-response.interceptor';

const transformBody = (metatype: Type<object>, body: object) =>
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  }).transform(body, { type: 'body', metatype });

const cases = [
  { label: 'create', metatype: CreateProductDto, body: { sku: 'SYNTHETIC-DTO', name: 'Synthetic DTO', barcode: '12345678' } },
  { label: 'update', metatype: UpdateProductDto, body: { name: 'Synthetic renamed product' } },
];

function fixture() {
  const service = { create: jest.fn().mockResolvedValue({ id: 'product-a' }), update: jest.fn().mockResolvedValue({ id: 'product-a' }) };
  const access = { getContext: jest.fn().mockResolvedValue({ entityId: 'entity-a', noAccess: false }) };
  const controller = new ProductController(service as any, access as any);
  const request = { user: { id: 'inventory-editor', effectivePermissions: ['inventory:update'] } };
  return { controller, request, service, access };
}

describe('product cost input after the real request DTO transform', () => {
  it.each(cases)('$label preserves an enumerable omitted cost property without requiring a cost write', async ({ label, metatype, body }) => {
    const dto = await transformBody(metatype, body);
    expect(dto).toBeInstanceOf(metatype);
    // ES2023 class-field emit materializes optional fields before class-transformer
    // copies the submitted JSON. This own property is absent from the request.
    expect(Object.hasOwn(body, 'purchaseCost')).toBe(false);
    expect(Object.getOwnPropertyDescriptor(dto, 'purchaseCost')).toMatchObject({ enumerable: true, value: undefined });
    expect(Object.keys(dto)).toContain('purchaseCost');
    expect(containsCostInput(dto)).toBe(false);
    const { controller, request, service, access } = fixture();
    if (label === 'create') {
      await expect(controller.create(request, dto)).resolves.toEqual({ id: 'product-a' });
      expect(service.create).toHaveBeenCalledWith('entity-a', dto);
    } else {
      await expect(controller.update(request, 'product-a', dto)).resolves.toEqual({ id: 'product-a' });
      expect(service.update).toHaveBeenCalledWith('entity-a', 'product-a', dto);
    }
    expect(access.getContext).toHaveBeenCalledWith('inventory-editor', 'inventory', undefined);
  });

  it.each(cases)('$label still rejects explicit zero or null cost before company/service work', async ({ label, metatype, body }) => {
    for (const purchaseCost of [0, null]) {
      const dto = await transformBody(metatype, { ...body, purchaseCost });
      expect(dto.purchaseCost).toBe(purchaseCost);
      expect(containsCostInput(dto)).toBe(true);
      const { controller, request, service, access } = fixture();
      const call = label === 'create' ? controller.create(request, dto) : controller.update(request, 'product-a', dto);
      await expect(call).rejects.toThrow('product_cost:update');
      expect(access.getContext).not.toHaveBeenCalled();
      expect(service.create).not.toHaveBeenCalled();
      expect(service.update).not.toHaveBeenCalled();
    }
  });

  it.each(cases)('$label still detects nested and localized explicit costs in transformed attributes', async ({ label, metatype, body }) => {
    for (const attributes of [{ supplierPrice: 0 }, { supplierPrice: null }, { variants: [{ 採購成本: '40' }] }, { group: { nested: { unitCost: 1 } } }]) {
      const dto = await transformBody(metatype, { ...body, attributes });
      expect(containsCostInput(dto)).toBe(true);
      const { controller, request, service, access } = fixture();
      await expect(label === 'create' ? controller.create(request, dto) : controller.update(request, 'product-a', dto)).rejects.toThrow('product_cost:update');
      expect(access.getContext).not.toHaveBeenCalled();
      expect(service.create).not.toHaveBeenCalled();
      expect(service.update).not.toHaveBeenCalled();
    }
  });

  it('ignores undefined only, including nested class-field placeholders', () => {
    expect(containsCostInput({ purchaseCost: undefined, attributes: { supplierPrice: undefined }, items: [{ unitCost: undefined }] })).toBe(false);
    for (const value of [0, null, false, '', {}, []]) expect(containsCostInput({ purchaseCost: value })).toBe(true);
    expect(containsCostInput({ costCenter: 'inventory', salesPrice: 100, attributes: { color: 'blue' } })).toBe(false);
  });

  it('retains the existing explicit cost-write grant for a transformed DTO', async () => {
    const dto = await transformBody(CreateProductDto, { ...cases[0].body, purchaseCost: 0 });
    const { controller, request, service } = fixture();
    request.user.effectivePermissions.push('product_cost:update');
    await expect(controller.create(request, dto)).resolves.toEqual({ id: 'product-a' });
    expect(service.create).toHaveBeenCalledWith('entity-a', dto);
  });
});
