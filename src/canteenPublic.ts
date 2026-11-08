import { randomBytes, randomInt, randomUUID, createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import express from 'express';
import { z } from 'zod/v4';
import { createCanteenModels } from './models';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Mongoose } from 'mongoose';
import type { Request, Response, RequestHandler } from 'express';
import type { CanteenConfig } from './canteenMenu';
import { createCanteenMenuServer } from './canteenMenu';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const secret = () => randomBytes(32).toString('base64url');
const cookie = 'canteen_session';
const emailSchema = z
  .email()
  .max(254)
  .transform((email) => email.toLowerCase());
const apiPath = '/api/canteen-public';
export const PUBLIC_CANTEEN_MCP = '/mcp/canteen-public';

type Mail = { to: string; subject: string; text: string };
export type CanteenPublicOptions = CanteenConfig & {
  publicUrl: string;
  mailReady: boolean;
  sendMail: (mail: Mail) => Promise<unknown>;
  secureCookies?: boolean;
};

class PublicCanteenError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

/** The public connection uses its own email profiles and never the owner's feedback file. */
export async function createPublicCanteenRouter(
  mongoose: Mongoose,
  options: CanteenPublicOptions,
): Promise<express.Router> {
  const router = express.Router();
  const models = createCanteenModels(mongoose);
  await Promise.all(Object.values(models).map((model) => model.init()));
  const endpoint = new URL(PUBLIC_CANTEEN_MCP, options.publicUrl).href;
  const feedbackDirectory = join(
    dirname(
      options.preferencesFile ??
        process.env.CANTEEN_PREFERENCES_FILE ??
        './data/canteen/preferences.json',
    ),
    'public',
  );
  const cookieOptions = {
    httpOnly: true,
    secure: options.secureCookies ?? true,
    sameSite: 'strict' as const,
    path: apiPath,
  };
  const route =
    (handler: RequestHandler): RequestHandler =>
    async (req, res, next) => {
      try {
        await handler(req, res, next);
      } catch (error) {
        next(error);
      }
    };
  const browserProfile = async (req: Request) => {
    const value = req.headers.cookie
      ?.split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(cookie + '='))
      ?.slice(cookie.length + 1);
    const credential =
      value &&
      (await models.credentials
        .findOne({
          _id: hash(value),
          kind: 'session',
          expiresAt: { $gt: new Date() },
        })
        .lean());
    if (!credential) throw new PublicCanteenError(401, 'sign_in_required');
    const profile = await models.profiles.findById(credential.profile).lean();
    if (!profile) throw new PublicCanteenError(401, 'sign_in_required');
    return profile;
  };
  router.use(apiPath, (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  router.get(apiPath + '/status', (_req, res) => {
    res.json({ mailReady: options.mailReady, endpoint });
  });
  router.post(
    apiPath + '/code',
    route(async (req, res) => {
      if (!options.mailReady) throw new PublicCanteenError(503, 'mail_not_configured');
      const { email } = z.object({ email: emailSchema }).parse(req.body);
      const previous = await models.codes.findById(email).lean();
      if (previous && Date.now() - previous.sentAt.getTime() < 60000)
        throw new PublicCanteenError(429, 'wait_before_resending');
      const code = randomInt(100000, 1000000).toString();
      const record = {
        hash: hash(email + ':' + code),
        attempts: 0,
        sentAt: new Date(),
        expiresAt: new Date(Date.now() + 10 * 60000),
      };
      await models.codes.findByIdAndUpdate(email, { $set: record }, { upsert: true });
      try {
        await options.sendMail({
          to: email,
          subject: '八三食堂登录验证码',
          text: `你的八三食堂登录验证码是：${code}\n10分钟内有效。验证后即可使用自己的菜品偏好与备注，无需注册VivianChat。\n如果不是你发起的登录，请忽略这封邮件。`,
        });
      } catch {
        await models.codes.deleteOne({ _id: email, hash: record.hash });
        throw new PublicCanteenError(503, 'mail_send_failed');
      }
      res.json({ sent: true });
    }),
  );
  router.post(
    apiPath + '/verify',
    route(async (req, res) => {
      const { email, code } = z
        .object({ email: emailSchema, code: z.string().regex(/^\d{6}$/) })
        .parse(req.body);
      const pending = await models.codes
        .findOneAndUpdate(
          {
            _id: email,
            expiresAt: { $gt: new Date() },
            attempts: { $lt: 5 },
          },
          { $inc: { attempts: 1 } },
          { new: true },
        )
        .lean();
      if (!pending || pending.hash !== hash(email + ':' + code))
        throw new PublicCanteenError(400, 'invalid_code');
      const consumed = await models.codes.deleteOne({ _id: email, hash: pending.hash });
      if (!consumed.deletedCount) throw new PublicCanteenError(400, 'invalid_code');
      const profile = await models.profiles
        .findOneAndUpdate(
          { email },
          {
            $setOnInsert: { _id: randomUUID(), email, createdAt: new Date() },
          },
          { upsert: true, new: true },
        )
        .lean();
      const token = secret();
      const lifetime = 7 * 86400000;
      await models.credentials.create({
        _id: hash(token),
        profile: profile!._id,
        kind: 'session',
        name: '浏览器',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + lifetime),
      });
      res.cookie(cookie, token, { ...cookieOptions, maxAge: lifetime });
      res.json({ email: profile!.email });
    }),
  );
  router.get(
    apiPath + '/profile',
    route(async (req, res) => {
      const profile = await browserProfile(req);
      const credentials = await models.credentials
        .find({ profile: profile._id, kind: 'client' })
        .sort({ createdAt: -1 })
        .lean();
      res.json({
        email: profile.email,
        connections: credentials.map(({ name, createdAt }) => ({ name, createdAt })),
      });
    }),
  );
  router.post(
    apiPath + '/connections',
    route(async (req, res) => {
      const profile = await browserProfile(req);
      const { name } = z.object({ name: z.string().trim().min(1).max(60) }).parse(req.body);
      const token = 'basan_' + secret();
      await models.credentials.create({
        _id: hash(token),
        profile: profile._id,
        kind: 'client',
        name,
        createdAt: new Date(),
      });
      res.json({ token, endpoint });
    }),
  );
  router.delete(
    apiPath + '/connections',
    route(async (req, res) => {
      const profile = await browserProfile(req);
      await models.credentials.deleteMany({ profile: profile._id, kind: 'client' });
      res.json({ revoked: true });
    }),
  );
  router.post(
    apiPath + '/logout',
    route(async (req, res) => {
      const value = req.headers.cookie
        ?.split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith(cookie + '='))
        ?.slice(cookie.length + 1);
      if (value) await models.credentials.deleteOne({ _id: hash(value), kind: 'session' });
      res.clearCookie(cookie, cookieOptions);
      res.json({ loggedOut: true });
    }),
  );
  router.post(
    PUBLIC_CANTEEN_MCP,
    route(async (req, res) => {
      const token = req.headers.authorization?.match(/^Bearer (\S+)$/i)?.[1];
      const credential =
        token && (await models.credentials.findOne({ _id: hash(token), kind: 'client' }).lean());
      if (!credential) {
        res
          .set('WWW-Authenticate', 'Bearer realm="basan-menu"')
          .status(401)
          .json({ error: 'invalid_token' });
        return;
      }
      const server = createCanteenMenuServer({
        menuFile: options.menuFile,
        preferencesFile: join(feedbackDirectory, credential.profile + '.json'),
      });
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      res.on('close', () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    }),
  );
  router.all(PUBLIC_CANTEEN_MCP, (_req, res) => {
    res.status(405).set('Allow', 'POST').end();
  });
  router.use((error: unknown, _req: Request, res: Response, next: express.NextFunction) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    if (error instanceof PublicCanteenError) {
      res.status(error.status).json({ error: error.code });
      return;
    }
    res
      .status(error instanceof z.ZodError ? 400 : 500)
      .json({ error: error instanceof z.ZodError ? 'invalid_input' : 'request_failed' });
  });
  return router;
}
