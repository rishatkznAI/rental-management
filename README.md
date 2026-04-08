
# Rental Management

Frontend on React/Vite and backend on Node/Express for an equipment rental management system.

## Project structure

- `src/` — frontend application
- `server/` — backend API for auth, CRUD, and Railway deployment

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

## Production

- Frontend is deployed via GitHub Pages workflow in [`.github/workflows/deploy.yml`](/Users/rishat/Downloads/Review%20attached%20requirements/.github/workflows/deploy.yml)
- Backend is deployed separately on Railway
- Production frontend uses `VITE_API_URL` to talk to the deployed backend
  
