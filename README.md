# mh-back — Monowara Hospital API

Express 5 + MongoDB API for `mh-front` (public site) and the admin dashboard.
Public host: `https://api.monowarahospital.com/api/<resource>` · local: `http://127.0.0.1:5020/api`.
Contract: `../mh-front/docs/API_CONTRACT.md` · progress/decisions: `../mh-front/docs/HANDOFF.md`.

```bash
npm install
cp .env.example .env          # set MONGODB_URI
npm run seed -- --dry-run     # validate ../mh-front/data/*.js against the models (no DB)
npm run seed -- --drop        # load the static data into MongoDB
npm run dev                   # http://127.0.0.1:5020/api/health
npm run check                 # esbuild syntax check (run before every handoff)
```

Layout: `src/modules/<name>/{model,routes,service}.js` · shared helpers in `src/lib` · middleware in
`src/middlewares` · every model re-exported from `src/models.js`.
