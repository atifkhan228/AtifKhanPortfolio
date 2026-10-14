import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.set('trust proxy', 1);
const PORT = Number(process.env.PORT || 3000);
const BUCKET = process.env.SUPABASE_BUCKET || 'portfolio-files';
const MAX_UPLOAD_MB = Math.max(1, Number(process.env.MAX_UPLOAD_MB || 100));
const ownerPassword = process.env.OWNER_PASSWORD;
const sessionSecret = process.env.SESSION_SECRET;
const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!ownerPassword || !sessionSecret || !supabaseUrl || !serviceKey) {
  console.error('Missing configuration. Copy .env.example to .env and fill every required value.');
  process.exit(1);
}
if (ownerPassword.length < 8) {
  console.error('OWNER_PASSWORD must be at least 8 characters. Use a stronger password before exposing the site publicly.');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

app.disable('x-powered-by');
app.use(helmet({
  // The site uses inline styling/script in one local-first HTML file.
  contentSecurityPolicy: false
}));
app.use(express.json({ limit: '1mb' }));
app.use(session({
  name: 'atif_portfolio_session',
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 8 * 60 * 60 * 1000
  }
}));
app.use('/api/login', rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: 'draft-8', legacyHeaders: false }));
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ok = /^(image\/|video\/|application\/|text\/|audio\/|font\/|model\/|)$/i.test(file.mimetype)
      || /\.(zip|rar|7z|pwn|amx|inc|sql|html|css|js|json|apk|aab|pdf|txt|md|png|jpe?g|gif|webp|mp4|webm|mov|mp3|wav)$/i.test(file.originalname);
    if (!ok) return cb(new Error('That file type is not allowed.'));
    cb(null, true);
  }
});

function ownerOnly(req, res, next) {
  if (req.session?.isOwner) return next();
  return res.status(401).json({ error: 'Owner login required.' });
}
function cleanName(name) {
  return String(name || 'upload').replace(/[^\w.\- ]/g, '_').replace(/\s+/g, '_').slice(-120) || 'upload';
}
function sendDbError(res, error) {
  console.error('Database/storage error:', error?.message || error);
  return res.status(500).json({ error: 'The server could not complete that action. Check the Supabase setup and server logs.' });
}

app.get('/api/session', (req, res) => res.json({ isOwner: Boolean(req.session?.isOwner) }));

app.post('/api/login', async (req, res) => {
  const password = String(req.body?.password || '');
  // The configured secret is compared server-side; it is never sent to the browser.
  const storedHash = await bcrypt.hash(ownerPassword, 10);
  const valid = await bcrypt.compare(password, storedHash);
  if (!valid) return res.status(401).json({ error: 'Incorrect password.' });
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: 'Could not start owner session.' });
    req.session.isOwner = true;
    req.session.save(saveErr => {
      if (saveErr) return res.status(500).json({ error: 'Could not save owner session.' });
      res.json({ ok: true });
    });
  });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('atif_portfolio_session');
    res.json({ ok: true });
  });
});

app.get('/api/categories', async (_req, res) => {
  const { data, error } = await supabase.from('portfolio_categories').select('id,name').order('name');
  if (error) return sendDbError(res, error);
  res.json(data || []);
});

app.post('/api/categories', ownerOnly, async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name || name.length > 60) return res.status(400).json({ error: 'Enter a category name (1–60 characters).' });
  const { data, error } = await supabase.from('portfolio_categories').insert({ name }).select('id,name').single();
  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'That category already exists.' });
    return sendDbError(res, error);
  }
  res.status(201).json(data);
});

app.get('/api/projects', async (_req, res) => {
  const { data, error } = await supabase
    .from('portfolio_projects')
    .select('id,title,description,category_id,file_name,file_path,mime_type,file_size,created_at,portfolio_categories(name)')
    .order('created_at', { ascending: false });
  if (error) return sendDbError(res, error);
  const projects = await Promise.all((data || []).map(async p => {
    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(p.file_path);
    return { ...p, category_name: p.portfolio_categories?.name || 'Uncategorized', file_url: urlData.publicUrl };
  }));
  res.json(projects);
});

app.post('/api/projects', ownerOnly, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose a file to upload.' });
  const title = String(req.body?.title || '').trim();
  const description = String(req.body?.description || '').trim().slice(0, 2000);
  const categoryId = Number(req.body?.category_id);
  if (!title || title.length > 100) return res.status(400).json({ error: 'Project title is required (maximum 100 characters).' });
  if (!Number.isInteger(categoryId)) return res.status(400).json({ error: 'Choose a category.' });

  const { data: category, error: categoryError } = await supabase
    .from('portfolio_categories').select('id').eq('id', categoryId).maybeSingle();
  if (categoryError) return sendDbError(res, categoryError);
  if (!category) return res.status(400).json({ error: 'That category does not exist. Refresh and choose again.' });

  const fileName = cleanName(req.file.originalname);
  const objectPath = `${Date.now()}-${crypto.randomUUID()}/${fileName}`;
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(objectPath, req.file.buffer, {
    contentType: req.file.mimetype || 'application/octet-stream',
    cacheControl: '3600',
    upsert: false
  });
  if (uploadError) return sendDbError(res, uploadError);

  const { data, error } = await supabase.from('portfolio_projects').insert({
    title, description, category_id: categoryId, file_name: fileName,
    file_path: objectPath, mime_type: req.file.mimetype || 'application/octet-stream',
    file_size: req.file.size
  }).select('id').single();

  if (error) {
    await supabase.storage.from(BUCKET).remove([objectPath]);
    return sendDbError(res, error);
  }
  res.status(201).json({ ok: true, id: data.id });
});

app.delete('/api/projects/:id', ownerOnly, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid project ID.' });
  const { data: project, error: readError } = await supabase.from('portfolio_projects')
    .select('id,file_path').eq('id', id).maybeSingle();
  if (readError) return sendDbError(res, readError);
  if (!project) return res.status(404).json({ error: 'Project not found.' });
  const { error: removeError } = await supabase.storage.from(BUCKET).remove([project.file_path]);
  if (removeError) return sendDbError(res, removeError);
  const { error } = await supabase.from('portfolio_projects').delete().eq('id', id);
  if (error) return sendDbError(res, error);
  res.json({ ok: true });
});

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: `File is too large. Maximum upload size is ${MAX_UPLOAD_MB} MB.` });
  }
  if (err) return res.status(400).json({ error: err.message || 'Request failed.' });
  res.status(500).json({ error: 'Unexpected server error.' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Atif Khan Portfolio running at http://127.0.0.1:${PORT}`);
  console.log('Local-only listener: this is not public until deliberately deployed.');
});
