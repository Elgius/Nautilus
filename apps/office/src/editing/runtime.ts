import { IResourceManagerService, LocaleType, LogLevel, mergeLocales, Univer, type IResources } from '@univerjs/core'
import { FUniver } from '@univerjs/core/facade'
import { UniverDocsPlugin } from '@univerjs/docs'
import { UniverSheetsPlugin } from '@univerjs/sheets'
import { UniverFormulaEnginePlugin } from '@univerjs/engine-formula'
import { UniverSheetsFormulaPlugin } from '@univerjs/sheets-formula'
import { UniverRenderEnginePlugin } from '@univerjs/engine-render'
import SheetsEnUS from '@univerjs/sheets/locale/en-US'
import '@univerjs/docs/facade'
import '@univerjs/sheets/facade'
import { requireEdit } from './common'

/** Exchange emits this envelope even for documents without drawings. It has no
 * anchors to invalidate; populated or unfamiliar resource shapes remain blocked. */
function emptyDrawingResource(name: string, data: string): boolean {
  if (name !== 'DOC_DRAWING_PLUGIN') return false
  try {
    const value = JSON.parse(data)
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      && Object.keys(value).every((key) => key === 'data' || key === 'order')
      && value.data !== null && typeof value.data === 'object' && !Array.isArray(value.data) && Object.keys(value.data).length === 0
      && Array.isArray(value.order) && value.order.length === 0
  } catch { return false }
}

/** One isolated, disposable headless instance per edit batch; never share units across requests. */
export function createEditingRuntime() {
  const univer = new Univer({ locale: LocaleType.EN_US, locales: { [LocaleType.EN_US]: mergeLocales(SheetsEnUS) }, logLevel: LogLevel.ERROR })
  univer.registerPlugin(UniverRenderEnginePlugin)
  univer.registerPlugin(UniverDocsPlugin)
  univer.registerPlugin(UniverSheetsPlugin)
  univer.registerPlugin(UniverFormulaEnginePlugin)
  univer.registerPlugin(UniverSheetsFormulaPlugin)
  return {
    api: FUniver.newAPI(univer),
    assertStructuralResources(resources: IResources | undefined) {
      const loaded = new Set(univer.__getInjector().get(IResourceManagerService).getAllResourceHooks().map((hook) => hook.pluginName as string))
      const unsupported = resources?.filter((resource) => !loaded.has(resource.name) && !['', '{}', '[]', 'null'].includes(resource.data.trim()) && !emptyDrawingResource(resource.name, resource.data)) ?? []
      requireEdit(!unsupported.length, `Structural edits require these Univer plugins: ${unsupported.map((resource) => resource.name).join(', ')}.`)
    },
    dispose: () => univer.dispose(),
  }
}

/** Save active plugin state while retaining opaque resources that this runtime cannot interpret. */
export function preserveResources<T extends { resources?: IResources }>(source: T, result: T): T {
  const generated = result.resources ?? []
  const names = new Set(generated.map((resource) => resource.name))
  result.resources = [...generated, ...structuredClone(source.resources?.filter((resource) => !names.has(resource.name)) ?? [])]
  return result
}
