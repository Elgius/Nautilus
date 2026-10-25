import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { HTTPException } from 'hono/http-exception'
import { timingSafeEqual } from 'node:crypto'
import { UniverInstanceType, type IDocumentData, type IWorkbookData } from '@univerjs/core'
import { ExchangeError, ExchangeFormat, exportToBuffer, importBuffer, type ISheetImportOptions } from '@univerjs-pro/exchange-node'
import { MAX_OFFICE_BYTES, validateOfficeContent } from '../../server/src/office-content'

export function createOfficeApp(secret: string) {
  const app = new Hono()
  app.get('/health', (c) => c.json({ status: secret.length >= 32 ? 'ok' : 'unconfigured' }))
  app.use('*', bodyLimit({ maxSize: MAX_OFFICE_BYTES + 1024 * 1024 }))
  app.use('*', async (c, next) => {
    if (secret.length < 32) throw new HTTPException(503, { message: 'Configure OFFICE_SERVICE_TOKEN with at least 32 characters.' })
    const provided = Buffer.from(c.req.header('Authorization') ?? ''), expected = Buffer.from(`Bearer ${secret}`)
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) throw new HTTPException(401, { message: 'Unauthorized.' })
    await next()
  })
  app.post('/import/:kind', async (c) => {
    const kind = c.req.param('kind')
    if (kind !== 'DOCUMENT' && kind !== 'SPREADSHEET') throw new HTTPException(400, { message: 'Invalid document type.' })
    const form = await c.req.formData(), file = form.get('file')
    if (!(file instanceof File) || !file.size || file.size > MAX_OFFICE_BYTES) throw new HTTPException(400, { message: 'Choose a non-empty file up to 10 MB.' })
    const extension = file.name.split('.').pop()?.toLowerCase()
    const buffer = Buffer.from(await file.arrayBuffer())
    let snapshot: IDocumentData | IWorkbookData
    if (kind === 'DOCUMENT') {
      if (extension !== 'doc' && extension !== 'docx') throw new HTTPException(400, { message: 'Choose a .doc or .docx file.' })
      snapshot = await importBuffer(buffer, { type: UniverInstanceType.UNIVER_DOC, format: extension === 'doc' ? ExchangeFormat.DOC : ExchangeFormat.DOCX, fileName: file.name })
    } else {
      const formats = { xls: ExchangeFormat.XLS, xlsx: ExchangeFormat.XLSX, csv: ExchangeFormat.CSV, tsv: ExchangeFormat.TSV }
      if (!extension || !Object.hasOwn(formats, extension)) throw new HTTPException(400, { message: 'Choose an .xls, .xlsx, .csv or .tsv file.' })
      snapshot = await importBuffer(buffer, { type: UniverInstanceType.UNIVER_SHEET, format: formats[extension as keyof typeof formats], fileName: file.name } as ISheetImportOptions & { fileName: string })
    }
    return c.json({ content: validateOfficeContent(kind, { format: 'univer', kind, snapshot }) })
  })
  app.post('/export', async (c) => {
    const input = await c.req.json().catch(() => { throw new HTTPException(400, { message: 'Provide valid JSON.' }) })
    if (input?.kind !== 'DOCUMENT' && input?.kind !== 'SPREADSHEET') throw new HTTPException(400, { message: 'Invalid document type.' })
    const content = validateOfficeContent(input.kind, input)
    const isDoc = content.kind === 'DOCUMENT'
    const file = isDoc ? await exportToBuffer(content.snapshot as unknown as IDocumentData, { type: UniverInstanceType.UNIVER_DOC, format: ExchangeFormat.DOCX }) :
      await exportToBuffer(content.snapshot as unknown as IWorkbookData, { type: UniverInstanceType.UNIVER_SHEET, format: ExchangeFormat.XLSX })
    if (file.byteLength > MAX_OFFICE_BYTES) throw new HTTPException(413, { message: 'The exported file exceeds 10 MB.' })
    return new Response(new Uint8Array(file), { headers: {
      'Content-Type': isDoc ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="document.${isDoc ? 'docx' : 'xlsx'}"`,
      'Cache-Control': 'no-store',
    } })
  })
  app.onError((error, c) => {
    if (error instanceof HTTPException) return c.json({ error: error.message }, error.status)
    if (error instanceof ExchangeError) {
      const unavailable = error.code === 'NATIVE_LOAD_FAILED'
      return c.json({ error: unavailable ? 'Office conversion is unavailable on this host.' : 'Could not convert this file. Check its format and contents.' }, unavailable ? 503 : 422)
    }
    console.error('Office conversion failed', error)
    return c.json({ error: 'Office conversion failed. Please try again.' }, 500)
  })
  return app
}
