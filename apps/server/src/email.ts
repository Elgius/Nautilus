import type { Database } from './db'
import type { Bindings } from './env'
import { isLocalDevelopment } from './env'

export async function sendEmail(env: Bindings, db: Database, message: {
  to: string
  subject: string
  text: string
}) {
  if (env.EMAIL_DELIVERY_MODE === 'outbox' && isLocalDevelopment(env)) {
    await db.emailMessage.create({ data: {
      recipient: message.to,
      subject: message.subject,
      text: message.text,
    } })
    return
  }
  if (env.EMAIL_DELIVERY_MODE !== 'resend' || !env.RESEND_API_KEY || !env.EMAIL_FROM) {
    throw new Error('Email delivery is not configured')
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [message.to], subject: message.subject, text: message.text }),
  })
  if (!response.ok) throw new Error(`Email provider returned status ${response.status}`)
}
