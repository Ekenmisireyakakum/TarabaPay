require('dotenv').config();

const express  = require('express');
const cors     = require('cors');
const helmet   = require('helmet');
const morgan   = require('morgan');
const path     = require('path');

const authRoutes     = require('./routes/auth');
const walletRoutes   = require('./routes/wallet');
const servicesRoutes = require('./routes/services');
const configRoutes   = require('./routes/config');
const transferRoutes = require('./routes/transfer');

const app  = express();
const PORT = process.env.PORT || 5500;

/* ── Security & Logging ─────────────────────────────────── */
app.use(helmet());
app.use(morgan('dev'));
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile, Postman, direct file open)
    // and any localhost / 127.0.0.1 port
    if (!origin) return callback(null, true);
    const allowed = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    callback(null, allowed ? true : new Error(`CORS blocked: ${origin}`));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));
// Pre-flight for all routes
app.options('*', cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ── Serve Static Frontend ──────────────────────────────── */
app.use(express.static(path.join(__dirname, '..', 'frontend')));

/* ── API Routes ─────────────────────────────────────────── */
app.use('/api/auth',     authRoutes);
app.use('/api/wallet',   walletRoutes);
app.use('/api/services', servicesRoutes);
app.use('/api/config',   configRoutes);
app.use('/api/transfer', transferRoutes);

/* ── Health Check ───────────────────────────────────────── */
app.get('/api/health', (_req, res) =>
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
);

/* ── SPA Fallback ───────────────────────────────────────── */
app.get('*', (_req, res) =>
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'))
);

/* ── Global Error Handler ───────────────────────────────── */
app.use((err, _req, res, _next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () =>
  console.log(`TarabaPay server → http://localhost:${PORT}`)
);
