# Connectify Frontend

Next.js + TypeScript frontend foundation for the messenger app. The current implementation covers:

- typed API integration for auth and current-user/profile flows
- persisted auth state with protected/public route redirects
- websocket connection manager and app-wide realtime provider
- auth pages, messenger shell/sidebar, and profile/settings UI
- frontend tests for auth, persistence, guards, profile flow, avatar validation, and websocket startup

## Backend Contract Notes

The backend currently supports:

- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `GET /api/v1/users/me`
- `PATCH /api/v1/users/me`
- `GET /api/v1/realtime/ws?token=...`

The backend does **not** currently expose:

- avatar file upload for profile images
- username mutation
- display-name persistence

The profile UI reflects that honestly:

- `description`, `status`, and `avatar_url` persist now
- username, display name, and avatar file upload are present in the UI but flagged as pending backend support

## Environment Variables

Copy `.env.example` to `.env.local` for local development.

```bash
cp .env.example .env.local
```

Variables:

- `NEXT_PUBLIC_API_BASE_URL`: backend REST base, default `http://localhost:8000/api/v1`
- `NEXT_PUBLIC_WS_BASE_URL`: backend websocket origin, default derived from the API URL

## Local Development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

Useful commands:

```bash
npm run lint
npm run test:run
npm run build
```

## Docker

Build and run the frontend container with the backend URLs injected at runtime:

```bash
docker build -t connectify-frontend .
docker run --rm -p 3000:3000 \
  -e NEXT_PUBLIC_API_BASE_URL=http://host.docker.internal:8000/api/v1 \
  -e NEXT_PUBLIC_WS_BASE_URL=ws://host.docker.internal:8000 \
  connectify-frontend
```

The image uses Next standalone output for a smaller production runtime.
