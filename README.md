
# Rental Management

Frontend on React/Vite and backend on Node/Express for an equipment rental management system.

## Project structure

- `src/` — frontend application
- `server/` — backend API for auth, CRUD, and Railway deployment
- `docs/processes-and-interface.md` — business process and interface map in Russian

## Local development

Frontend:

```bash
npm install
npm run dev
```

Backend:

```bash
cd server
npm install
npm run dev
```

## Scripts

- `npm run dev` — start the frontend locally
- `npm run build` — build the frontend
- `npm test` — run the Node test suite from `tests/`
- `npm run test:e2e` — run Playwright end-to-end tests

## Deployment

- Frontend supports static deployment (`vite build`) and includes `public/404.html` for SPA routing on GitHub Pages
- `vercel.json` keeps Vercel rewrites compatible with the hash-router shell
- Backend is deployed separately on Railway
- Production frontend uses `VITE_API_URL` to talk to the deployed backend
  
