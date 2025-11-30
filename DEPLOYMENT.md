# Deployment Guide

This guide covers deploying the SpacetimeDB multiplayer game to production.

## Architecture Overview

- **Server**: Rust module running on SpacetimeDB Maincloud
- **Client**: Vite+React app deployed to Vercel

## Prerequisites

1. [SpacetimeDB CLI](https://spacetimedb.com/install) installed
2. [Vercel CLI](https://vercel.com/download) installed (optional, can use web dashboard)
3. GitHub account (for SpacetimeDB login)
4. Vercel account

## Step 1: Deploy Server to SpacetimeDB Maincloud

### Login to SpacetimeDB

```bash
spacetime logout
spacetime login
```

This will open your browser to log in with GitHub. Once complete, your CLI will be authenticated.

### Publish the Server Module

From the project root:

```bash
cd server
spacetime publish -s maincloud vibe-multiplayer
```

**Important**: Note the module name from the output. You'll need this for the client configuration.

### Verify Server Deployment

Visit your [SpacetimeDB profile](https://spacetimedb.com/profile) to see your published modules.

You can also navigate directly to your database at: `https://spacetimedb.com/vibe-multiplayer`

## Step 2: Deploy Client to Vercel

### Option A: Deploy via Vercel CLI

From the project root:

```bash
cd client
vercel
```

Follow the prompts:
- Set up and deploy: Yes
- Which scope: (select your account)
- Link to existing project: No
- Project name: (e.g., `vibe-multiplayer-client`)
- Directory: `./` (already in client directory)
- Override settings: No

### Option B: Deploy via GitHub Integration

1. Push your code to GitHub
2. Go to [Vercel Dashboard](https://vercel.com/dashboard)
3. Click "Add New..." → "Project"
4. Import your GitHub repository
5. Set **Root Directory** to `client`
6. Click "Deploy"

### Configure Environment Variables

In the Vercel dashboard for your project:

1. Go to **Settings** → **Environment Variables**
2. Add the following variables:

| Name | Value | Environment |
|------|-------|-------------|
| `VITE_SPACETIME_HOST` | `maincloud.spacetimedb.com` | Production |
| `VITE_SPACETIME_MODULE_NAME` | `vibe-multiplayer` | Production |

3. Click "Save"
4. Redeploy the project for changes to take effect

## Step 3: Test Production Deployment

1. Visit your Vercel deployment URL
2. Open browser console to verify connection logs
3. Register a player and test movement
4. Open in multiple browser windows/devices to test multiplayer

## Local Development

### Running the Server Locally

```bash
cd server
spacetime start vibe-multiplayer
```

The server will run at `localhost:3000`.

### Running the Client Locally

```bash
cd client
npm run dev
```

The client will connect to `localhost:3000` by default.

### Testing with Production Server Locally

Create `client/.env.local`:

```env
VITE_SPACETIME_HOST=maincloud.spacetimedb.com
VITE_SPACETIME_MODULE_NAME=vibe-multiplayer
```

Then run `npm run dev`. The client will connect to your production SpacetimeDB instance.

## Troubleshooting

### Client can't connect to server

- Verify environment variables are set correctly in Vercel
- Check browser console for connection errors
- Ensure server module is published and running on Maincloud

### "Module not found" error

- Verify `VITE_SPACETIME_MODULE_NAME` matches your published module name exactly
- Check SpacetimeDB dashboard to confirm module is published

### Build fails on Vercel

- Ensure `vercel.json` is in the `client` directory
- Check build logs for TypeScript or dependency errors
- Verify `package.json` scripts are correct

### WebSocket connection fails

- For production: Ensure using `https://` protocol (handled automatically)
- For local dev: Ensure using `ws://` protocol (handled automatically)
- Check firewall/network settings

## Updating the Deployment

### Update Server

```bash
cd server
spacetime publish -s maincloud vibe-multiplayer
```

### Update Client

**Via CLI:**
```bash
cd client
vercel --prod
```

**Via GitHub:**
Push to your main branch, Vercel will auto-deploy.

## Monitoring

- **Server logs**: `spacetime logs vibe-multiplayer -s maincloud`
- **Client logs**: Vercel Dashboard → Deployments → (select deployment) → Runtime Logs
- **Database inspection**: SpacetimeDB web dashboard

## Additional Resources

- [SpacetimeDB Documentation](https://spacetimedb.com/docs)
- [Vercel Documentation](https://vercel.com/docs)
- [SpacetimeDB Maincloud Guide](https://spacetimedb.com/docs/maincloud)
