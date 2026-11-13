'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const initializeSqlJs = require('sql.js');

const app = express();
const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '127.0.0.1';

async function startServer() {
  const SQL = await initializeSqlJs();
  const databasePath = path.join(__dirname, 'resilinet.db');
  const database = fs.existsSync(databasePath)
    ? new SQL.Database(new Uint8Array(fs.readFileSync(databasePath)))
    : new SQL.Database();

  database.exec(`
    CREATE TABLE IF NOT EXISTS checkins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sos_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      battery_percentage REAL NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id TEXT UNIQUE,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      relationship TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS guides (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      content TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS shelters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      address TEXT NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      supplies TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS shelter_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shelter_id INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('Open', 'Full', 'Closed')),
      water INTEGER NOT NULL CHECK (water IN (0, 1)),
      power INTEGER NOT NULL CHECK (power IN (0, 1)),
      reported_at TEXT NOT NULL
    );
  `);

  for (const [table, column] of [['checkins', 'resolved'], ['sos_logs', 'resolved']]) {
    const columns = getRows(`PRAGMA table_info(${table})`);
    if (!columns.some((entry) => entry.name === column)) {
      database.run(`ALTER TABLE ${table} ADD COLUMN ${column} INTEGER NOT NULL DEFAULT 0`);
    }
  }

  function persistDatabase() {
    fs.writeFileSync(databasePath, Buffer.from(database.export()));
  }

  function getRows(sql, values = []) {
    const statement = database.prepare(sql);
    const rows = [];
    try {
      statement.bind(values);
      while (statement.step()) {
        rows.push(statement.getAsObject());
      }
    } finally {
      statement.free();
    }
    return rows;
  }

  function getSetting(key) {
    const rows = getRows('SELECT value FROM settings WHERE key = ?', [key]);
    return rows.length ? rows[0].value : null;
  }

  function setSetting(key, value) {
    database.run(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `, [key, value]);
  }

  const guides = [
    {
      title: 'Call for emergency help',
      category: 'Emergency basics',
      content: 'Use your local emergency number when available. Give your location first, then describe the emergency and the number of people affected. Follow the dispatcher’s instructions. This app does not contact emergency services.'
    },
    {
      title: 'Severe bleeding',
      category: 'First aid',
      content: 'Call emergency services. Apply firm, continuous direct pressure with clean cloth or gauze. If blood soaks through, add more material without lifting the first layer. Do not remove embedded objects; apply pressure around them. Use a tourniquet only if trained or directed by a dispatcher.'
    },
    {
      title: 'Burns',
      category: 'First aid',
      content: 'Cool a thermal burn under clean, cool running water for 20 minutes if available. Remove jewellery and loose clothing near the area, but do not pull away anything stuck to the skin. Do not apply ice, oils, or creams. Seek urgent medical care for serious burns.'
    },
    {
      title: 'Possible broken bone',
      category: 'First aid',
      content: 'Keep the person and injured area still. Do not try to straighten the limb or push a bone back in. Apply a wrapped cold pack if available and seek medical help. Check circulation and sensation beyond the injury.'
    },
    {
      title: 'Earthquake: during and after',
      category: 'Natural hazards',
      content: 'During shaking, drop, cover, and hold on; stay away from windows. If indoors, remain inside until shaking stops. Afterwards, expect aftershocks, avoid damaged buildings and downed wires, and follow local authority instructions.'
    },
    {
      title: 'Floodwater safety',
      category: 'Natural hazards',
      content: 'Never walk, swim, or drive through floodwater. Move to higher ground and follow evacuation instructions. Avoid downed power lines and contaminated water. Return only when authorities say it is safe.'
    },
    {
      title: 'Prepare an emergency kit',
      category: 'Preparedness',
      content: 'Pack drinking water, ready-to-eat food, essential medicines, first-aid supplies, a torch and spare batteries, a phone power bank, hygiene items, copies of important contacts, and supplies for children or pets. Follow local guidance on amounts and evacuation routes.'
    }
  ];

  const guideCount = getRows('SELECT COUNT(*) AS count FROM guides')[0].count;
  if (guideCount === 0) {
    for (const guide of guides) {
      database.run(
        'INSERT INTO guides (title, category, content) VALUES (?, ?, ?)',
        [guide.title, guide.category, guide.content]
      );
    }
  }

  if (getSetting('timer_preferences') === null) {
    setSetting('timer_preferences', JSON.stringify({ defaultDurationSeconds: 300 }));
  }

  persistDatabase();

  app.use(express.json({ limit: '10kb' }));

  const eventClients = new Set();
  function broadcastEvent(type, data) {
    const message = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of eventClients) {
      client.write(message);
    }
  }

  app.post('/api/checkin', (request, response) => {
    const { eventId, message } = request.body ?? {};

    if (
      typeof eventId !== 'string' ||
      eventId.length < 1 ||
      eventId.length > 100 ||
      typeof message !== 'string' ||
      message.trim().length < 1 ||
      message.length > 500
    ) {
      return response.status(400).json({
        error: 'eventId and a message of 1 to 500 characters are required.'
      });
    }

    const createdAt = new Date().toISOString();
    database.run(`
      INSERT INTO checkins (event_id, message, created_at)
      VALUES (?, ?, ?)
      ON CONFLICT(event_id) DO NOTHING
    `, [eventId, message.trim(), createdAt]);
    const created = database.getRowsModified() === 1;
    persistDatabase();
    if (created) {
      broadcastEvent('update', { type: 'checkin', eventId, createdAt });
    }

    return response.status(created ? 201 : 200).json({
      ok: true,
      created,
      createdAt
    });
  });

  app.post('/api/sos', (request, response) => {
    const { eventId, latitude, longitude, batteryPercentage } = request.body ?? {};

    if (
      typeof eventId !== 'string' ||
      eventId.length < 1 ||
      eventId.length > 100 ||
      typeof latitude !== 'number' ||
      !Number.isFinite(latitude) ||
      latitude < -90 ||
      latitude > 90 ||
      typeof longitude !== 'number' ||
      !Number.isFinite(longitude) ||
      longitude < -180 ||
      longitude > 180 ||
      typeof batteryPercentage !== 'number' ||
      !Number.isFinite(batteryPercentage) ||
      batteryPercentage < 0 ||
      batteryPercentage > 100
    ) {
      return response.status(400).json({
        error: 'A valid eventId, GPS position, and battery percentage (0–100) are required.'
      });
    }

    const createdAt = new Date().toISOString();
    database.run(`
      INSERT INTO sos_logs (
        event_id, latitude, longitude, battery_percentage, created_at
      )
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(event_id) DO NOTHING
    `, [eventId, latitude, longitude, batteryPercentage, createdAt]);
    const created = database.getRowsModified() === 1;
    persistDatabase();
    if (created) {
      broadcastEvent('update', { type: 'sos', eventId, createdAt });
    }

    return response.status(created ? 201 : 200).json({
      ok: true,
      created,
      createdAt
    });
  });

  app.get('/api/contacts', (_request, response) => {
    response.json(getRows(`
      SELECT id, client_id AS clientId, name, phone, relationship
      FROM contacts ORDER BY id DESC
    `));
  });

  app.post('/api/contacts', (request, response) => {
    const { clientId, name, phone, relationship } = request.body ?? {};
    const cleanName = typeof name === 'string' ? name.trim() : '';
    const cleanPhone = typeof phone === 'string' ? phone.trim() : '';
    const cleanRelationship = typeof relationship === 'string' ? relationship.trim() : '';

    if (
      typeof clientId !== 'string' ||
      clientId.length < 1 ||
      clientId.length > 100 ||
      cleanName.length < 1 ||
      cleanName.length > 100 ||
      cleanPhone.length < 3 ||
      cleanPhone.length > 40 ||
      !/^[+()\d.\-\s]+$/.test(cleanPhone) ||
      cleanRelationship.length < 1 ||
      cleanRelationship.length > 80
    ) {
      return response.status(400).json({
        error: 'A valid clientId, name, phone number, and relationship are required.'
      });
    }

    database.run(`
      INSERT INTO contacts (client_id, name, phone, relationship)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(client_id) DO NOTHING
    `, [clientId, cleanName, cleanPhone, cleanRelationship]);
    const created = database.getRowsModified() === 1;
    persistDatabase();

    return response.status(created ? 201 : 200).json({ ok: true, created });
  });

  app.get('/api/guides', (_request, response) => {
    response.json(getRows(
      'SELECT id, title, category, content FROM guides ORDER BY category, title'
    ));
  });

  app.get('/api/shelters', (_request, response) => {
    response.json(getRows(`
      SELECT id, name, address, latitude, longitude, supplies
      FROM shelters ORDER BY name
    `));
  });

  app.get('/api/shelters/status', (_request, response) => {
    response.json(getRows(`
      SELECT reports.shelter_id AS shelterId, reports.status,
        reports.water, reports.power, reports.reported_at AS reportedAt
      FROM shelter_reports AS reports
      JOIN (
        SELECT shelter_id, MAX(id) AS latest_id
        FROM shelter_reports
        GROUP BY shelter_id
      ) AS latest ON latest.latest_id = reports.id
      ORDER BY reports.shelter_id
    `));
  });

  app.post('/api/shelters/status', (request, response) => {
    const { shelterId, status, water, power } = request.body ?? {};
    if (
      !Number.isInteger(shelterId) || shelterId < 1 ||
      !['Open', 'Full', 'Closed'].includes(status) ||
      typeof water !== 'boolean' || typeof power !== 'boolean'
    ) {
      return response.status(400).json({
        error: 'A valid shelterId, status, water, and power value are required.'
      });
    }
    if (getRows('SELECT id FROM shelters WHERE id = ?', [shelterId]).length === 0) {
      return response.status(404).json({ error: 'Shelter not found.' });
    }

    const reportedAt = new Date().toISOString();
    database.run(`
      INSERT INTO shelter_reports (shelter_id, status, water, power, reported_at)
      VALUES (?, ?, ?, ?, ?)
    `, [shelterId, status, Number(water), Number(power), reportedAt]);
    persistDatabase();
    broadcastEvent('update', { type: 'shelter-status', shelterId, reportedAt });
    return response.status(201).json({ ok: true, reportedAt });
  });

  app.get('/api/triage', (_request, response) => {
    response.json(getRows(`
      SELECT 'checkin' AS type, id, event_id AS eventId, message,
        NULL AS latitude, NULL AS longitude, NULL AS batteryPercentage,
        created_at AS createdAt, resolved
      FROM checkins
      UNION ALL
      SELECT 'sos' AS type, id, event_id AS eventId, NULL AS message,
        latitude, longitude, battery_percentage AS batteryPercentage,
        created_at AS createdAt, resolved
      FROM sos_logs
    `).map((entry) => ({ ...entry, resolved: Boolean(entry.resolved) }))
      .sort((left, right) => {
        const leftPriority = (left.resolved ? 2 : 0) + (left.type === 'sos' ? 0 : 1);
        const rightPriority = (right.resolved ? 2 : 0) + (right.type === 'sos' ? 0 : 1);
        if (leftPriority !== rightPriority) {
          return leftPriority - rightPriority;
        }
        if (left.type === 'sos' && left.batteryPercentage !== right.batteryPercentage) {
          return left.batteryPercentage - right.batteryPercentage;
        }
        return left.createdAt.localeCompare(right.createdAt);
      }));
  });

  app.patch('/api/beacons/:id/resolve', (request, response) => {
    const beaconId = Number(request.params.id);
    if (!Number.isSafeInteger(beaconId) || beaconId < 1) {
      return response.status(400).json({ error: 'A valid beacon id is required.' });
    }
    database.run('UPDATE sos_logs SET resolved = 1 WHERE id = ?', [beaconId]);
    if (database.getRowsModified() === 0) {
      return response.status(404).json({ error: 'SOS beacon not found.' });
    }
    persistDatabase();
    broadcastEvent('update', { type: 'beacon-resolved', id: beaconId });
    return response.json({ ok: true, id: beaconId });
  });

  app.get('/api/events', (request, response) => {
    response.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive'
    });
    response.flushHeaders();
    response.write('retry: 3000\n\n');
    eventClients.add(response);

    const heartbeat = setInterval(() => {
      response.write(': keepalive\n\n');
    }, 25000);
    request.on('close', () => {
      clearInterval(heartbeat);
      eventClients.delete(response);
    });
  });

  app.get('/api/timer', (_request, response) => {
    const rawTimer = getSetting('timer_state');
    const rawPreferences = getSetting('timer_preferences');
    response.json({
      timer: rawTimer ? JSON.parse(rawTimer) : null,
      preferences: rawPreferences
        ? JSON.parse(rawPreferences)
        : { defaultDurationSeconds: 300 }
    });
  });

  app.post('/api/timer', (request, response) => {
    const { action, timerId } = request.body ?? {};
    if (
      !['configure', 'acknowledge', 'trigger'].includes(action) ||
      typeof timerId !== 'string' ||
      timerId.length < 1 ||
      timerId.length > 100
    ) {
      return response.status(400).json({
        error: 'A valid timerId and action (configure, acknowledge, or trigger) are required.'
      });
    }

    let timer;
    if (action === 'configure') {
      const { durationSeconds, deadlineAt } = request.body;
      if (!Number.isInteger(durationSeconds) || durationSeconds < 10 || durationSeconds > 86400) {
        return response.status(400).json({
          error: 'durationSeconds must be an integer between 10 and 86400.'
        });
      }
      const deadlineTimestamp = deadlineAt === undefined
        ? Date.now() + durationSeconds * 1000
        : typeof deadlineAt === 'string' ? Date.parse(deadlineAt) : Number.NaN;
      if (!Number.isFinite(deadlineTimestamp)) {
        return response.status(400).json({ error: 'deadlineAt must be a valid timestamp.' });
      }

      timer = {
        timerId,
        status: 'active',
        durationSeconds,
        deadlineAt: new Date(deadlineTimestamp).toISOString()
      };
      setSetting('timer_preferences', JSON.stringify({ defaultDurationSeconds: durationSeconds }));
    } else {
      const currentTimerText = getSetting('timer_state');
      const currentTimer = currentTimerText ? JSON.parse(currentTimerText) : null;
      if (!currentTimer || currentTimer.timerId !== timerId) {
        return response.status(409).json({ error: 'This timer is no longer active.' });
      }

      if (action === 'acknowledge') {
        if (currentTimer.status === 'active' && Date.parse(currentTimer.deadlineAt) <= Date.now()) {
          return response.status(409).json({ error: 'The countdown has already expired.' });
        }
        timer = currentTimer.status === 'active'
          ? { ...currentTimer, status: 'acknowledged', acknowledgedAt: new Date().toISOString() }
          : currentTimer;
        if (currentTimer.status === 'triggered') {
          return response.status(409).json({ error: 'This timer has already triggered.' });
        }
      } else {
        if (currentTimer.status === 'acknowledged') {
          return response.status(409).json({ error: 'This timer was already acknowledged.' });
        }
        if (currentTimer.status === 'active' && Date.parse(currentTimer.deadlineAt) > Date.now()) {
          return response.status(409).json({ error: 'The countdown has not expired yet.' });
        }
        timer = currentTimer.status === 'triggered'
          ? currentTimer
          : { ...currentTimer, status: 'triggered', triggeredAt: new Date().toISOString() };
      }
    }

    setSetting('timer_state', JSON.stringify(timer));
    persistDatabase();
    return response.json({ ok: true, timer });
  });

  app.get('/api/health', (_request, response) => {
    response.json({ ok: true, timestamp: new Date().toISOString() });
  });

  app.use('/api', (_request, response) => {
    response.status(404).json({ error: 'API route not found.' });
  });

  app.get('/responders', (_request, response) => {
    response.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
  });

  app.use(express.static(path.join(__dirname, '..', 'frontend')));

  app.use((error, _request, response, _next) => {
    if (error instanceof SyntaxError && 'body' in error) {
      return response.status(400).json({ error: 'Request body must be valid JSON.' });
    }

    console.error('Request failed:', error);
    return response.status(500).json({ error: 'An unexpected server error occurred.' });
  });

  const server = app.listen(port, host, () => {
    console.log(`NoSignal is running at http://localhost:${port}`);
  });

  function shutdown() {
    server.close(() => {
      database.close();
      process.exit(0);
    });
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

startServer().catch((error) => {
  console.error('Could not start NoSignal:', error);
  process.exitCode = 1;
});
