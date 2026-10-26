import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const packageRoot = resolve(dirname(require.resolve('@univerjs/ui')), '../..');

// Exercise the installed controller, including our Bun patch, without loading
// Univer's React UI or using real timers. Keep the lifecycle await controllable.
function controllerHarness(format: 'es' | 'cjs') {
  const source = readFileSync(resolve(packageRoot, `lib/${format}/index.js`), 'utf8');
  const start = source.indexOf('var SingleUnitUIController = class');
  const end = source.indexOf('\n//#endregion', start);
  assert.ok(start >= 0 && end > start, 'Univer controller must be available');
  const timers = new Map<number, () => void>();
  let timerId = 0;
  class Disposable {
    _disposed = false;
    disposables: { dispose(): void }[] = [];
    disposeWithMe(value: { dispose(): void }) { this.disposables.push(value); return value; }
    dispose() { this._disposed = true; this.disposables.forEach((value) => value.dispose()); }
  }
  const Controller = runInNewContext(`${source.slice(start, end).replaceAll('_univerjs_core.', '')}\nSingleUnitUIController;`, {
    Disposable,
    _defineProperty: (target: object, key: string, value: unknown) => Object.assign(target, { [key]: value }),
    Quantity: { OPTIONAL: 0 }, IWorkbenchService: {},
    LifecycleStages: { Ready: 1, Rendered: 2, Steady: 3 },
    LifecycleUnreachableError: class extends Error {}, STEADY_TIMEOUT: 3000,
    window: { setTimeout: (callback: () => void) => { timers.set(++timerId, callback); return timerId; } },
    clearTimeout: (id: number) => timers.delete(id),
    requestAnimationFrame: (callback: () => void) => callback(),
  });
  let ready!: () => void;
  const readyPromise = new Promise<void>((resolve) => { ready = resolve; });
  const lifecycle = { onStage: () => readyPromise, stage: 0 };
  let renders = 0;
  const subscription = { subscribe: () => ({ dispose() {} }) };
  const controller = new Controller(
    { get: () => null }, { focused$: subscription },
    { registerRootContainerElement: () => ({ dispose() {} }), registerContentElement: () => ({ dispose() {} }) },
    lifecycle, { getRenderAll: () => { renders++; return new Map(); }, created$: subscription, disposed$: subscription },
  );
  let mount!: () => Promise<void>;
  controller.bootstrap = (callback: () => Promise<void>) => { mount = callback; return { dispose() {} }; };
  controller._bootstrapWorkbench();
  return { controller, mount: () => mount(), ready, lifecycle, timers, renders: () => renders };
}

for (const format of ['es', 'cjs'] as const) {
  test(`${format}: disposal while waiting for Ready cannot schedule a stale render`, async () => {
    const h = controllerHarness(format);
    const mounting = h.mount();
    h.controller.dispose();
    h.ready();
    await mounting;
    assert.equal(h.timers.size, 0);
    assert.equal(h.renders(), 0);
  });

  test(`${format}: late workbench mount after disposal is ignored`, async () => {
    const h = controllerHarness(format);
    h.controller.dispose();
    h.ready();
    await h.mount();
    assert.equal(h.timers.size, 0);
  });

  test(`${format}: active editor renders and disposal cancels pending work`, async () => {
    const h = controllerHarness(format);
    h.ready();
    await h.mount();
    assert.equal(h.timers.size, 1);
    const [id, render] = [...h.timers][0];
    h.timers.delete(id);
    render();
    assert.equal(h.renders(), 1);
    assert.equal(h.lifecycle.stage, 2);
    h.controller.dispose();
    assert.equal(h.timers.size, 0);
    // A callback already queued by the browser must also be harmless.
    assert.doesNotThrow(render);
    assert.equal(h.renders(), 1);
  });
}
