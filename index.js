require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');

const PORT = Number(process.env.PORT) || 3000;
const ACCESS_PASSWORD = process.env.ACCESS_PASSWORD || process.env.ACCESS_SWORD;
// Forçando novo build na vercel

if (!ACCESS_PASSWORD || ACCESS_PASSWORD.length < 8) {
  console.error('ACCESS_PASSWORD is missing or shorter than 8 characters. Check your environment variables.');
  process.exit(1);
}

// ---------- Database connection ----------

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: 10,
  idleTimeoutMillis: 30000,
});

pool.on('error', (error) => {
  console.error('Unexpected PostgreSQL pool error:', error.message);
});

// ---------- App and security ----------

const app = express();

app.disable('x-powered-by');
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        // Allows the panel to load over plain http on localhost in every browser.
        'upgrade-insecure-requests': null,
      },
    },
  })
);

function safeEqual(a, b) {
  const hashA = crypto.createHash('sha256').update(String(a)).digest();
  const hashB = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

// Counts only wrong-password responses (401). Validation errors do not count.
const failedAttemptsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  requestWasSuccessful: (req, res) => res.statusCode !== 401,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas incorretas. Aguarde 15 minutos e tente novamente.' },
});

function requireAccess(req, res, next) {
  const provided = req.get('x-access-password') || '';
  if (!safeEqual(provided, ACCESS_PASSWORD)) {
    return res.status(401).json({ error: 'Senha incorreta.' });
  }
  return next();
}

app.use('/api', failedAttemptsLimiter, requireAccess, express.json({ limit: '20kb' }));

// ---------- Validation ----------

const FIELD_LABELS = {
  full_name: 'Nome',
  email: 'E-mail',
  phone: 'Telefone',
  document: 'Documento',
  city: 'Cidade',
  state: 'Estado',
  country: 'País',
  notes: 'Observações',
};

const MAX_LENGTH = {
  full_name: 150,
  email: 150,
  phone: 30,
  document: 30,
  city: 80,
  state: 40,
  country: 60,
  notes: 2000,
};

function clean(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function isValidCpf(digits) {
  if (!/^\d{11}$/.test(digits) || /^(\d)\1{10}$/.test(digits)) return false;
  for (let length = 9; length <= 10; length += 1) {
    let sum = 0;
    for (let i = 0; i < length; i += 1) {
      sum += Number(digits[i]) * (length + 1 - i);
    }
    const checkDigit = ((sum * 10) % 11) % 10;
    if (checkDigit !== Number(digits[length])) return false;
  }
  return true;
}

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return false;
  return value >= '1900-01-01' && date.getTime() <= Date.now();
}

function validateClient(body) {
  const input = body && typeof body === 'object' ? body : {};
  const errors = [];
  const values = {};

  Object.keys(MAX_LENGTH).forEach((field) => {
    values[field] = clean(input[field]);
    if (values[field] && values[field].length > MAX_LENGTH[field]) {
      errors.push(`O campo ${FIELD_LABELS[field]} aceita no máximo ${MAX_LENGTH[field]} caracteres.`);
    }
  });

  if (!values.full_name) errors.push('O nome é obrigatório.');
  if (!values.country) values.country = 'Brasil';

  if (values.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) {
    errors.push('E-mail inválido.');
  }

  values.birth_date = clean(input.birth_date);
  if (values.birth_date && !isValidDate(values.birth_date)) {
    errors.push('Data de nascimento inválida.');
  }

  if (values.document) {
    const candidate = values.document;
    if (/^\d{3}\.?\d{3}\.?\d{3}-?\d{2}$/.test(candidate)) {
      const digits = candidate.replace(/\D/g, '');
      if (isValidCpf(digits)) {
        values.document = `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
      } else {
        errors.push('CPF inválido. Confira os números.');
      }
    } else if (/^[A-Za-z0-9 .\-]{5,20}$/.test(candidate)) {
      values.document = candidate.toUpperCase();
    } else {
      errors.push('Documento inválido. Use um CPF ou um passaporte (5 a 20 letras e números).');
    }
  }

  return { errors, values };
}

function toParams(values) {
  return [
    values.full_name,
    values.email,
    values.phone,
    values.document,
    values.birth_date,
    values.city,
    values.state,
    values.country,
    values.notes,
  ];
}

function sendValidationError(res, errors) {
  return res.status(400).json({ error: errors.join(' ') });
}

function sendDuplicateError(res) {
  return res.status(409).json({ error: 'Já existe um cliente cadastrado com este documento.' });
}

function parseId(value) {
  return /^\d{1,18}$/.test(value) ? value : null;
}

// ---------- Routes ----------

const CLIENT_COLUMNS = `id, full_name, email, phone, document,
                        to_char(birth_date, 'YYYY-MM-DD') AS birth_date,
                        city, state, country, notes, created_at`;

const SEARCH_FILTER = `
  full_name ILIKE $1
  OR email ILIKE $1
  OR phone ILIKE $1
  OR document ILIKE $1
  OR city ILIKE $1
`;

app.get('/api/clients', async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const offset = (page - 1) * limit;
    const search = String(req.query.search || '').trim().slice(0, 100);

    // Escapes LIKE wildcards so the user's text is always treated as literal text.
    const pattern = `%${search.replace(/[\\%_]/g, '\\$&')}%`;

    const [rowsResult, countResult] = await Promise.all([
      pool.query(
        `SELECT ${CLIENT_COLUMNS}
           FROM clients
          WHERE ${SEARCH_FILTER}
          ORDER BY full_name ASC, id ASC
          LIMIT $2 OFFSET $3`,
        [pattern, limit, offset]
      ),
      pool.query(`SELECT COUNT(*)::int AS total FROM clients WHERE ${SEARCH_FILTER}`, [pattern]),
    ]);

    res.json({
      data: rowsResult.rows,
      total: countResult.rows[0].total,
      page,
      limit,
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/clients', async (req, res, next) => {
  const { errors, values } = validateClient(req.body);
  if (errors.length > 0) return sendValidationError(res, errors);

  try {
    const result = await pool.query(
      `INSERT INTO clients
         (full_name, email, phone, document, birth_date, city, state, country, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING ${CLIENT_COLUMNS}`,
      toParams(values)
    );
    return res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') return sendDuplicateError(res);
    return next(error);
  }
});

app.put('/api/clients/:id', async (req, res, next) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Identificador inválido.' });

  const { errors, values } = validateClient(req.body);
  if (errors.length > 0) return sendValidationError(res, errors);

  try {
    const result = await pool.query(
      `UPDATE clients
          SET full_name = $1, email = $2, phone = $3, document = $4, birth_date = $5,
              city = $6, state = $7, country = $8, notes = $9, updated_at = now()
        WHERE id = $10
        RETURNING ${CLIENT_COLUMNS}`,
      [...toParams(values), id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Cliente não encontrado. Talvez já tenha sido excluído.' });
    }
    return res.json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') return sendDuplicateError(res);
    return next(error);
  }
});

app.delete('/api/clients/:id', async (req, res, next) => {
  const { id } = req.params;
  const password = req.headers['x-access-password'];

  // Trava de segurança obrigatória para o painel
  if (password !== process.env.ACCESS_PASSWORD) {
    return res.status(401).json({ error: 'Senha de acesso incorreta.' });
  }

  try {
    const result = await pool.query('DELETE FROM clients WHERE id = $1 RETURNING *', [id]);
    
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Cliente não encontrado.' });
    }
    
    return res.status(200).json({ message: 'Cliente excluído com sucesso!' });
  } catch (error) {
    return next(error);
  }
});


app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Rota não encontrada.' });
});

// Serves the front end (the files inside the "public" folder).
app.use(express.static(path.join(__dirname, 'public')));

app.use((error, req, res, next) => {
  if (error.type === 'entity.parse.failed' || error.type === 'entity.too.large') {
    return res.status(400).json({ error: 'Dados enviados em formato inválido.' });
  }
  console.error(error);
  return res.status(500).json({ error: 'Erro interno do servidor.' });
});

async function start() {
  try {
    await pool.query('SELECT 1');
  } catch (error) {
    console.error('Could not connect to PostgreSQL. Check the DB_* values in your .env file.');
    console.error(error.message);
    process.exit(1);
  }
  app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

start();