import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

// Load the module first in a fresh CommonJS process. Direct service imports in
// ts-jest can hide the production controller -> registry -> mailroom cycle.
const bootstrapScript = String.raw`
require('reflect-metadata');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const mode = process.argv[1], root = process.cwd();
let stripped = 0, externalCalls = 0;
const failExternal = () => { externalCalls++; throw Error('UNEXPECTED_EXTERNAL_EFFECT'); };
require('node:net').Socket.prototype.connect = failExternal;
globalThis.fetch = failExternal;
const compilerOptions = {
  module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10,
  target: ts.ScriptTarget.ES2021, experimentalDecorators: true,
  emitDecoratorMetadata: true, esModuleInterop: true, skipLibCheck: true,
  noEmitOnError: false,
};
const host = ts.createCompilerHost(compilerOptions), originalRead = host.readFile;
host.readFile = filename => {
  let source = originalRead(filename);
  if (mode === 'legacy' && filename.endsWith(path.sep + 'repair-prerequisites.service.ts')) {
    source = source.replace(/@Inject\s*\(\s*forwardRef\s*\(\s*\(\s*\)\s*=>\s*Repair(?:TestRegistry|Materials)Service\s*\)\s*\)\s*/g, () => { stripped++; return ''; });
  }
  return source;
};
const emitted = new Map();
host.writeFile = (filename, data, _bom, _onError, sourceFiles) => {
  if (filename.endsWith('.js') && sourceFiles) for (const source of sourceFiles) emitted.set(path.resolve(source.fileName), data);
};
const modulePath = path.join(root, 'src/modules/mailroom/mailroom.module.ts');
ts.createProgram([modulePath], compilerOptions, host).emit();
Module._extensions['.ts'] = (module, filename) => {
  const compiled = emitted.get(path.resolve(filename));
  if (!compiled) throw Error('MISSING_PROGRAM_EMIT');
  module._compile(compiled, filename);
};
const { MailroomModule } = require(modulePath);
const { Test } = require('@nestjs/testing');
const { RepairPrerequisitesService } = require(path.join(root, 'src/modules/mailroom/repair-prerequisites.service.ts'));
const { RepairTestRegistryService } = require(path.join(root, 'src/modules/mailroom/repair-test-registry.service.ts'));
const { RepairMaterialsService } = require(path.join(root, 'src/modules/mailroom/repair-materials.service.ts'));
const { MailroomService } = require(path.join(root, 'src/modules/mailroom/mailroom.service.ts'));
const { RepairWorkbenchService } = require(path.join(root, 'src/modules/mailroom/repair-workbench.service.ts'));
const { RepairTodoService } = require(path.join(root, 'src/modules/mailroom/repair-todo.service.ts'));
const originalProviders = Reflect.getMetadata('providers', MailroomModule);
const protectedProviders = new Set([RepairPrerequisitesService, RepairTestRegistryService, RepairMaterialsService]);
const omitted = mode === 'missing_registry' ? RepairTestRegistryService : mode === 'missing_materials' ? RepairMaterialsService : null;
const providers = originalProviders.filter(provider => provider !== omitted);
const actual = new Set(originalProviders), external = new Set();
for (const provider of originalProviders) {
  const dependencies = [...(Reflect.getMetadata('design:paramtypes', provider) || [])];
  for (const self of Reflect.getMetadata('self:paramtypes', provider) || []) dependencies[self.index] = self.param;
  for (const dependency of dependencies) {
    const token = dependency && typeof dependency.forwardRef === 'function' ? dependency.forwardRef() : dependency;
    if (token && !actual.has(token) && !protectedProviders.has(token)) external.add(token);
  }
}
const externalMocks = [...external].map(token => ({ provide: token, useValue: Object.freeze({}) }));
(async () => {
  let container;
  try {
    container = await Test.createTestingModule({ providers: [...providers, ...externalMocks] }).setLogger(false).compile();
    const prerequisites = container.get(RepairPrerequisitesService);
    const registry = container.get(RepairTestRegistryService), materials = container.get(RepairMaterialsService);
    const guards = [MailroomService, RepairWorkbenchService, RepairTodoService].map(provider => ({
      name: provider.name, injected: container.get(provider).prerequisites === prerequisites,
    }));
    console.log(JSON.stringify({ status: 'READY', stripped, externalCalls, providerCount: providers.length,
      allActualInstances: providers.every(provider => container.get(provider) instanceof provider),
      registryInjected: prerequisites.registry === registry && registry instanceof RepairTestRegistryService,
      materialsInjected: prerequisites.materials === materials && materials instanceof RepairMaterialsService,
      guards,
    }));
  } catch (error) {
    console.log(JSON.stringify({ status: 'FAILED', stripped, externalCalls,
      errorName: error.name, errorClass: error.constructor.name,
      dependencyIndex: error.context ? error.context.index : Number((error.message.match(/index \[(\d+)\]/) || [])[1]),
      provider: typeof error.type === 'string' ? error.type : error.type && error.type.name,
    }));
  } finally {
    if (container) await container.close();
  }
})().catch(() => { process.exitCode = 1; });
`;

type BootstrapReceipt = {
  status: 'READY' | 'FAILED';
  stripped: number;
  externalCalls: number;
  providerCount?: number;
  allActualInstances?: boolean;
  registryInjected?: boolean;
  materialsInjected?: boolean;
  guards?: { name: string; injected: boolean }[];
  errorName?: string;
  errorClass?: string;
  dependencyIndex?: number;
  provider?: string;
};

function bootstrap(
  mode: 'current' | 'legacy' | 'missing_registry' | 'missing_materials',
): BootstrapReceipt {
  const stdout = execFileSync(process.execPath, ['-e', bootstrapScript, mode], {
    cwd: resolve(__dirname, '../../..'),
    encoding: 'utf8',
    timeout: 20_000,
    maxBuffer: 128 * 1024,
  });
  return JSON.parse(stdout.trim()) as BootstrapReceipt;
}

describe('real CommonJS MailroomModule-first repair provider bootstrap', () => {
  it('reproduces the pre-fix required registry metadata failure without altering tracked source', () => {
    expect(bootstrap('legacy')).toMatchObject({
      status: 'FAILED',
      stripped: 2,
      externalCalls: 0,
      errorClass: 'UndefinedDependencyException',
      dependencyIndex: 0,
    });
  });

  it('uses all real MailroomModule providers and injects both mandatory prerequisites plus all three guard consumers', () => {
    const result = bootstrap('current');
    expect(result).toMatchObject({
      status: 'READY',
      stripped: 0,
      externalCalls: 0,
      allActualInstances: true,
      registryInjected: true,
      materialsInjected: true,
      guards: [
        { name: 'MailroomService', injected: true },
        { name: 'RepairWorkbenchService', injected: true },
        { name: 'RepairTodoService', injected: true },
      ],
    });
    expect(result.providerCount).toBeGreaterThan(10);
  });

  it.each([
    ['missing_registry', 0],
    ['missing_materials', 1],
  ] as const)(
    'cannot silently substitute an absent mandatory provider (%s)',
    (mode, dependencyIndex) => {
      expect(bootstrap(mode)).toMatchObject({
        status: 'FAILED',
        externalCalls: 0,
        errorName: 'Error',
        dependencyIndex,
        provider: 'RepairPrerequisitesService',
      });
    },
  );
});
