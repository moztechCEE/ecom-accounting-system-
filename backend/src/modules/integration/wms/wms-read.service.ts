import { projectWmsFact, WmsBinding, WmsFact, WmsReadScope } from './wms-read.contract';

/** Ports must be implemented by a vetted GET-only exporter and trusted mapping
 * repository. Intentionally not wired to legacy WMS or any production route. */
export interface WmsReadPorts {
  binding(scope: WmsReadScope, erpOrderId: string): Promise<WmsBinding | null>;
  fact(scope: WmsReadScope, binding: WmsBinding): Promise<WmsFact>;
}
export class WmsReadService {
  constructor(private readonly ports: WmsReadPorts) {}
  async order(scope: WmsReadScope, erpOrderId: string) {
    if (!scope.entityId || !scope.brandCodes.length || !/^[A-Za-z0-9_-]{1,128}$/.test(erpOrderId)) throw new Error('WMS_SCOPE_DENIED');
    const binding = await this.ports.binding(scope, erpOrderId);
    if (!binding) throw new Error('WMS_ORDER_UNMAPPED');
    if (binding.erpOrderId !== erpOrderId || binding.entityId !== scope.entityId || !scope.brandCodes.includes(binding.brandCode)) throw new Error('WMS_SCOPE_DENIED');
    const fact = await this.ports.fact(scope, binding);
    return projectWmsFact(fact, scope, binding);
  }
}
