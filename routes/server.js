const express = require('express');
const router = express.Router();
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');
const DB_PATH = path.join(__dirname, '../data.db');

let db;

const dbInitPromise = initDb();

async function sync_data() {
    const person_id = document.getElementById('person_id').value;
    const url = base + '/web/person/data/' + encodeURIComponent(person_id) + '/sync';
    const r = await fetch(url);
    const data = await r.json();

    document.getElementById('fall_cnt').value = data.falls;
    document.getElementById('last_synced').value = data.sync_time;
    print(data);
}

async function initDb() {
    db = await open({filename: DB_PATH, driver: sqlite3.Database});

    await db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            uid INTEGER PRIMARY KEY AUTOINCREMENT,
            pass TEXT NOT NULL,
            username TEXT NOT NULL UNIQUE
        );        
    `);

    await db.exec(`
        CREATE TABLE IF NOT EXISTS monitored_people (
            person_id INTEGER PRIMARY KEY AUTOINCREMENT,
            uid INTEGER,
            fullname TEXT NOT NULL,
            FOREIGN KEY(uid) REFERENCES users(uid)
        );        
    `);

    await db.exec(`
        CREATE TABLE IF NOT EXISTS devices (
            dev_id INTEGER PRIMARY KEY AUTOINCREMENT,
            person_id INTEGER NOT NULL,
            last_logged DATETIME DEFAULT CURRENT_TIMESTAMP,
            falls_real INTEGER,
            falls_cancelled INTEGER,
            phone_nr TEXT DEFAULT '',
            timeout INTEGER DEFAULT 10,
            FOREIGN KEY(person_id) REFERENCES monitored_people(person_id)
        );        
    `);
}

async function dbReadyMiddleware(req, res, next) {
    if (db) {
        next();
    } else {
        try {
            await dbInitPromise;
            next();
        } catch (err) {
            console.error("Database initialization failed:", err);
            res.status(503).json({ error: "Service unavailable: dtabase not ready" });
        }
    }
}

router.use(dbReadyMiddleware);

const nowTs = () => Math.floor(Date.now() / 1000);

//controller ep

router.post('/dev/sync/:person_id', async (req, res) => {
  const person_id = req.params.person_id;
  const falls_r = Number(req.body.falls_r);
  const falls_c = Number(req.body.falls_c);

  await db.run(`UPDATE devices SET falls_real = falls_real + ?, falls_cancelled = falls_cancelled + ?, last_logged = ? WHERE person_id = ?`, [falls_r, falls_c, nowTs(), person_id]);

  res.json({ ok: true });
});

router.get('/dev/config/:person_id', async (req, res) => {
  const person_id = req.params.person_id;

  const row = await db.get(`
    SELECT phone_nr, timeout
    FROM devices
    WHERE person_id = ?
  `, [person_id]);

  if (!row) {
    return res.json({ ok: false, error: "Device not found" });
  }

  res.json({
    ok: true,
    phone_nr: row.phone_nr,
    timeout: row.timeout
  });
});

//web ep

async function ensureDevice(person_id) {
  await db.run(`
    INSERT INTO devices (person_id, falls_real, falls_cancelled)
    SELECT ?, 0, 0
    WHERE NOT EXISTS (SELECT 1 FROM devices WHERE person_id = ?)
  `, [person_id, person_id]);
}

router.post('/web/person/data/:person_id/phone_nr', async (req, res) => {
  const person_id = req.params.person_id;
  const phone_nr = req.body.phone_nr;

  await ensureDevice(person_id);

  await db.run(`UPDATE devices SET phone_nr = ? WHERE person_id = ?`, [phone_nr, person_id]);

  res.json({ ok: true, phone_nr });
});

router.post('/web/person/data/:person_id/timeout', async (req, res) => {
  const person_id = req.params.person_id;
  const timeout = req.body.timeout;

  await ensureDevice(person_id);

  await db.run(`UPDATE devices SET timeout = ? WHERE person_id = ?`, [timeout, person_id]);

  res.json({ ok: true, timeout });
});

router.get('/web/person/find/:fullname', async (req, res) => {
    const fullname = req.params.fullname;

    const personRow = await db.get(`
        SELECT person_id 
        FROM monitored_people 
        WHERE fullname = ?
    `, [fullname]);

    if (!personRow) {
        return res.json({ ok: false, error: "Person not found" });
    }

    const person_id = personRow.person_id;

    const deviceRow = await db.get(`
        SELECT 
            IFNULL(phone_nr, '') AS phone_nr,
            IFNULL(timeout, 10) AS timeout,
            IFNULL(falls_real, 0) AS falls_real,
            IFNULL(falls_cancelled, 0) AS falls_cancelled
        FROM devices
        WHERE person_id = ?
    `, [person_id]);

    const response = {
        ok: false
    };
    
    if (deviceRow) {
        response.ok = true;
        response.phone_nr = deviceRow.phone_nr;
        response.timeout = deviceRow.timeout;
        response.falls_cancelled = deviceRow.falls_cancelled;
        response.falls_real = deviceRow.falls_real;
        response.person_id = person_id;
    }

    res.json(response);
});

router.get('/web/person/data/:person_id/sync', async (req, res) => {
    const person_id = req.params.person_id;

    const row = await db.get(`
        SELECT falls_real, falls_cancelled, last_logged
        FROM devices 
        WHERE person_id = ?
    `, [person_id]);

    if (!row)
        return res.json({ ok: false, error: "Device not found" });

    res.json({
        ok: true,
        falls_real: row.falls_real ?? 0,
        falls_cancelled: row.falls_cancelled ?? 0,
        sync_time: row.last_logged
    });
});



module.exports = router;