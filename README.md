# Atif Khan Developer Portfolio

Mobile-first black/red portfolio. Local web server on Android/Termux, with Supabase Postgres metadata and cloud file storage.

## 1. Requirements
- Termux with Node.js and npm
- A Supabase project
- Your profile photo `1791966668675.jpg` copied into this project's `public/` folder

## 2. Supabase setup
1. Create a project at https://supabase.com/ and open **SQL Editor**.
2. Run all of `schema.sql`.
3. Open **Storage**, create a bucket named `portfolio-files`, and set it to **Public** because portfolio assets are meant to be viewable/downloadable by visitors. Restrict bucket size/type in Storage settings if available.
4. In Project Settings > API (or API Keys), copy the project URL and the server-side **service role / secret key**. Keep it secret; never put it in `public/`, screenshots, GitHub, or a shared ZIP.
5. The server uses the secret key for database and storage actions. Keep `.env` private. Before public launch, add stronger deployment protections, HTTPS, persistent session storage, and proper upload scanning.

## 3. Install on Termux
```sh
pkg update
pkg install nodejs-lts nano
mkdir -p ~/AtifKhanPortfolio
cd ~/AtifKhanPortfolio
```
Extract this project into `~/AtifKhanPortfolio` so `server.js`, `package.json`, and `schema.sql` are directly inside it. Then:
```sh
cp .env.example .env
nano .env
npm install
```
Fill in `.env`:
- `OWNER_PASSWORD`: choose a strong password at least 12 characters long. For your first local test you can use the requested password, but change it before any public deployment.
- `SESSION_SECRET`: a long random secret; generate one with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` and paste it.
- `SUPABASE_URL`: your Supabase project URL.
- `SUPABASE_SERVICE_ROLE_KEY`: your service role/secret key. Server-side only.

## 4. Add your photo
On Android shared storage, your photo should be:
`/storage/emulated/0/Download/1791966668675.jpg`

Run:
```sh
termux-setup-storage
mkdir -p ~/AtifKhanPortfolio/public
cp /storage/emulated/0/Download/1791966668675.jpg ~/AtifKhanPortfolio/public/1791966668675.jpg
```
If your actual project folder differs, change the destination path accordingly.

## 5. Start and open locally
```sh
cd ~/AtifKhanPortfolio
npm start
```
Open Chrome on the same phone and visit:
`http://127.0.0.1:3000`

Stop the server with `CTRL+C` in Termux. The server binds to `127.0.0.1`, so it is only available on the phone itself by default.

## 6. Important notes
- The two initial categories are `SAMP Servers [Gamemode]` and `Websites`.
- New categories are loaded automatically into both the public category list and the owner upload form.
- Visitors can view/download assets from the public bucket. Do not upload private credentials, database dumps with secrets, or files you do not have rights to share.
- The initial server accepts uploads up to `MAX_UPLOAD_MB` (100 MB by default) into memory before cloud upload. Avoid very large files on a 4 GB RAM phone; reduce `MAX_UPLOAD_MB` or use resumable/direct-to-storage uploads for larger videos.
- Standard Supabase uploads are best for smaller files; for files larger than around 6 MB, resumable uploads are more reliable. See https://supabase.com/docs/guides/storage/uploads/standard-uploads
- This is a local prototype, not a production-hardened public deployment. The default Express session store is in-memory and is not appropriate for production. Use a persistent session store and HTTPS before public launch.
