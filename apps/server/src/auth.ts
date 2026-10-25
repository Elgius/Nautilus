import { betterAuth } from 'better-auth/minimal'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import { organization } from 'better-auth/plugins'
import type { Database } from './db'
import type { Bindings } from './env'
import { sendEmail } from './email'
import { isLocalDevelopment } from './env'

export function createAuth(env: Bindings, db: Database) {
  return betterAuth({
    appName: 'Nautilus',
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.WEB_ORIGIN],
    advanced: {
      ipAddress: { ipAddressHeaders: isLocalDevelopment(env) ? ['x-forwarded-for'] : ['cf-connecting-ip'] },
    },
    database: prismaAdapter(db, { provider: 'postgresql', transaction: true }),
    user: {
      additionalFields: {
        platformRole: { type: 'string', defaultValue: 'user', input: false },
      },
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      requireEmailVerification: true,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await sendEmail(env, db, { to: user.email, subject: 'Reset your Nautilus password', text: `Reset your password: ${url}` })
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      sendVerificationEmail: async ({ user, url }) => {
        await sendEmail(env, db, { to: user.email, subject: 'Verify your Nautilus email', text: `Verify your email: ${url}` })
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      cookieCache: { enabled: false },
    },
    rateLimit: { enabled: true, storage: 'database' },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/sign-up/email') return
        const email = typeof ctx.body?.email === 'string' ? ctx.body.email.trim().toLowerCase() : ''
        const invitationId = ctx.headers?.get('x-invitation-id')
        const invitation = invitationId ? await db.invitation.findFirst({
          where: { id: invitationId, email, status: 'pending', expiresAt: { gt: new Date() } },
          select: { id: true },
        }) : null
        if (!invitation) throw new APIError('FORBIDDEN', { message: 'A valid invitation for this email is required.' })
        return { context: { body: { ...ctx.body, email } } }
      }),
    },
    databaseHooks: {
      session: {
        create: {
          before: async (session) => {
            const memberships = await db.member.findMany({ where: { userId: session.userId }, take: 2 })
            return { data: { ...session, activeOrganizationId: memberships.length === 1 ? memberships[0].organizationId : null } }
          },
        },
      },
    },
    plugins: [organization({
      allowUserToCreateOrganization: async (user) => {
        const account = await db.user.findUnique({ where: { id: user.id }, select: { platformRole: true } })
        return account?.platformRole === 'admin'
      },
      requireEmailVerificationOnInvitation: true,
      invitationExpiresIn: 60 * 60 * 48,
      cancelPendingInvitationsOnReInvite: true,
      organizationHooks: {
        beforeCreateOrganization: async ({ user }) => {
          const account = await db.user.findUnique({ where: { id: user.id }, select: { platformRole: true } })
          if (account?.platformRole !== 'admin') throw new APIError('FORBIDDEN', { message: 'Only platform administrators can create organisations.' })
        },
        // The only direct membership creation is the platform admin creating an organisation.
        // Other users must use acceptInvitation, which checks recipient, expiry and verification.
        beforeAddMember: async ({ user }) => {
          const account = await db.user.findUnique({ where: { id: user.id }, select: { platformRole: true } })
          if (account?.platformRole !== 'admin') throw new APIError('FORBIDDEN', { message: 'Membership requires an accepted invitation.' })
        },
      },
      sendInvitationEmail: async ({ id, email, organization }) => {
        const url = new URL('/accept-invitation', env.WEB_ORIGIN)
        url.searchParams.set('invitationId', id)
        await sendEmail(env, db, {
          to: email,
          subject: `Join ${organization.name} on Nautilus`,
          text: `You have been invited to ${organization.name}. Sign up or sign in with this email, then accept the invitation: ${url}`,
        })
      },
    })],
  })
}

export type Auth = ReturnType<typeof createAuth>
