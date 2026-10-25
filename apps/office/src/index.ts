import { createOfficeApp } from './app'

const app = createOfficeApp(process.env.OFFICE_SERVICE_TOKEN ?? '')
export default { port: Number(process.env.PORT ?? 8790), hostname: process.env.HOST ?? '127.0.0.1', fetch: app.fetch }
