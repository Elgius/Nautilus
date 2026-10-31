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
      const unsupported = resources?.filter((resource) => !loaded.has(resource.name) && !['', '{}', '[]', 'null'].includes(resource.data.trim())) ?? []
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
