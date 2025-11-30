---
description: Start the multiplayer game (server + client)
---

# Start Game Workflow

Run these two commands to start the game:

## Terminal 1: Start SpacetimeDB Server (WSL)
```bash
wsl -e bash -c "cd /mnt/c/Users/gabeb/OneDrive/Desktop/'vibe code game december'/server && ~/.local/bin/spacetime start"
```

## Terminal 2: Start Client Dev Server
```bash
cd "c:\Users\gabeb\OneDrive\Desktop\vibe code game december\client"
npm run dev
```

## Access the Game
Once both are running, open your browser to: `http://localhost:5173/`

---

## Notes
- You do NOT need to run `spacetime build` or `spacetime publish` every time
- Only rebuild/republish when you change server code (database schema or reducers)
- The client dev server will auto-reload when you change client code
