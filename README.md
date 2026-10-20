# Study Notes — Vercel deployment

This folder is a standalone Vercel project. It includes the web app and its API routes. No API keys, database passwords, or other secret values are included in these files.

## Deploy

1. Unzip this folder and import it into a Git repository, or run `npx vercel` from this folder.
2. In Vercel, use this folder as the project root. The build command is `npm run build` and the output folder is `dist`.
3. Create a PostgreSQL database with your preferred provider.
4. Run `schema.sql` once in that database's SQL editor.
5. In Vercel **Project Settings → Environment Variables**, add:
   - `DATABASE_URL` — the database provider's connection string.
   - `GEMINI_API_KEY` — a Gemini API key for server-side study summaries and answers.
6. Redeploy after adding the variables.

Keep both values server-only: do not prefix them with `VITE_`, add them to `index.html`, or commit a `.env` file. `.env.example` contains names only.

## File handling

Files up to 20 MB are accepted. To stay within Vercel's 4.5 MB function-request limit, files up to 3 MB can use direct visual analysis; larger files are read in the browser (PDF text extraction or image OCR) before their text is sent to the API. Large image-only PDFs may not contain extractable text.

## Local build

Run `npm install`, then `npm run build`. The Vercel API bundle is generated in `api/index.js` from the included backend sources.

For local database-backed operation, set `DATABASE_URL` and `GEMINI_API_KEY` in your shell or a local `.env` file before starting the Vercel development server. Never upload or commit that local file.
