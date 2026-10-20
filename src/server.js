import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import cron from 'node-cron';
import config, { rootDir } from './config.js';
import { listTenders, getTender, getStats, listRuns, updateTenderFields, getDocument } from './db.js';
import { runCrawl, crawlStatus, rescoreAll } from './crawl.js';
import { listSources } from './sources/index.js';
import { downloadDocuments, storeAndAnalyze, safeName } from './documents.js';
import { sendTestMail, sendDigest } from './notify.js';
import { aiStatus } from './ai.js';

export function buildApp({ logger = true } = {}) {
  const app = Fastify({ logger: logger ? { level: 'info' } : false, bodyLimit: config.unterlagenMaxMb * 1024 * 1024 });

  // Dateien für "Datei hinzufügen" kommen als Rohdaten
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));

  // Optionaler Zugangsschutz (nur nötig, wenn der Server im Netzwerk erreichbar sein soll)
  if (config.accessToken) {
    const expected = Buffer.from(config.accessToken);
    app.addHook('onRequest', async (request, reply) => {
      if (!request.url.startsWith('/api/')) return;
      const given = Buffer.from(String(request.headers['x-zugangstoken'] || ''));
      if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
        reply.code(401).send({ fehler: 'Zugangstoken fehlt oder ist falsch.' });
      }
    });
  }

  app.register(fastifyStatic, { root: path.join(rootDir, 'public'), prefix: '/' });

  app.get('/api/status', async () => ({
    suchlauf: crawlStatus(),
    statistik: getStats(),
    quellen: listSources(),
    einstellungen: {
      firma: config.firmaName,
      adresse: config.firmaAdresse || null,
      zeitplan: config.suchlaufZeitplan,
      mailAktiv: config.mail.aktiv,
      mailEmpfaenger: config.mail.to,
      mindestPunkteAnzeige: config.mindestPunkteAnzeige,
      mindestPunkteMail: config.mindestPunkteMail,
      maxEntfernungKm: config.maxEntfernungKm,
    },
    ki: await aiStatus(),
  }));

  app.get('/api/ausschreibungen', async (request) => {
    const q = request.query || {};
    return listTenders({
      minPunkte: q.minPunkte ?? config.mindestPunkteAnzeige,
      gewerk: q.gewerk || null,
      quelle: q.quelle || null,
      status: q.status || null,
      suche: q.suche || null,
      maxKm: q.maxKm || null,
      nurOffen: q.alle !== '1',
      sort: q.sort || 'punkte',
      limit: Math.min(Number(q.limit) || 50, 200),
      offset: Number(q.offset) || 0,
    });
  });

  app.get('/api/ausschreibungen/:id', async (request, reply) => {
    const t = getTender(request.params.id);
    if (!t) return reply.code(404).send({ fehler: 'Nicht gefunden' });
    return t;
  });

  const STATUSWERTE = ['neu', 'interessant', 'abgelehnt', 'angeboten'];
  app.patch('/api/ausschreibungen/:id', async (request, reply) => {
    const t = getTender(request.params.id);
    if (!t) return reply.code(404).send({ fehler: 'Nicht gefunden' });
    const { status, notiz } = request.body || {};
    const fields = {};
    if (status !== undefined) {
      if (!STATUSWERTE.includes(status)) return reply.code(400).send({ fehler: 'Ungültiger Status' });
      fields.status = status;
    }
    if (notiz !== undefined) fields.notiz = String(notiz).slice(0, 5000);
    updateTenderFields(t.id, fields);
    return getTender(t.id);
  });

  app.post('/api/ausschreibungen/:id/unterlagen-laden', async (request, reply) => {
    try {
      return { dokumente: await downloadDocuments(request.params.id) };
    } catch (error) {
      return reply.code(400).send({ fehler: error.message });
    }
  });

  app.post('/api/ausschreibungen/:id/datei', async (request, reply) => {
    const t = getTender(request.params.id);
    if (!t) return reply.code(404).send({ fehler: 'Nicht gefunden' });
    if (!Buffer.isBuffer(request.body) || !request.body.length) return reply.code(400).send({ fehler: 'Keine Datei übermittelt.' });
    const name = decodeURIComponent(String(request.headers['x-dateiname'] || 'datei'));
    return { dokumente: await storeAndAnalyze(t.id, name, request.body) };
  });

  app.get('/api/dokumente/:id/datei', async (request, reply) => {
    const doc = getDocument(request.params.id);
    const base = path.resolve(config.dataDir, 'unterlagen');
    if (!doc || !path.resolve(doc.pfad).startsWith(base) || !fs.existsSync(doc.pfad)) return reply.code(404).send({ fehler: 'Nicht gefunden' });
    reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(safeName(doc.dateiname))}`);
    return reply.send(fs.createReadStream(doc.pfad));
  });

  app.post('/api/suchlauf', async () => {
    runCrawl().catch((error) => app.log.error(error, 'Suchlauf fehlgeschlagen'));
    return { gestartet: true, suchlauf: crawlStatus() };
  });

  app.get('/api/suchlaeufe', async () => ({ laeufe: listRuns(20) }));

  app.post('/api/neu-bewerten', async () => rescoreAll());

  app.post('/api/testmail', async (request, reply) => {
    try {
      return await sendTestMail();
    } catch (error) {
      return reply.code(400).send({ fehler: error.message });
    }
  });

  app.post('/api/benachrichtigen', async (request, reply) => {
    try {
      return await sendDigest();
    } catch (error) {
      return reply.code(400).send({ fehler: error.message });
    }
  });

  return app;
}

export async function startServer() {
  const app = buildApp();
  if (config.suchlaufZeitplan && cron.validate(config.suchlaufZeitplan)) {
    cron.schedule(config.suchlaufZeitplan, () => {
      runCrawl().catch((error) => app.log.error(error, 'Geplanter Suchlauf fehlgeschlagen'));
    });
    app.log.info(`Täglicher Suchlauf geplant: "${config.suchlaufZeitplan}"`);
  }
  await app.listen({ port: config.port, host: config.host });
  console.log(`\n  Vergaberadar läuft: http://localhost:${config.port}/\n  Zum Beenden dieses Fenster schließen oder Strg+C drücken.\n`);
  if (config.suchlaufBeimStart) runCrawl().catch((error) => app.log.error(error, 'Start-Suchlauf fehlgeschlagen'));
  return app;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(rootDir, 'src', 'server.js')) {
  startServer().catch((error) => {
    console.error('Start fehlgeschlagen:', error.message);
    if (error.code === 'EADDRINUSE') console.error(`Port ${config.port} ist belegt – läuft der Vergaberadar schon?`);
    process.exit(1);
  });
}
