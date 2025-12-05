---
description: Start the multiplayer game (server + client)
---

# Start Game Workflow

## When Server Schema Changes (After Editing Reducers/Tables)

**IMPORTANT:** If you modified server code (schema, reducers, tables), publish first:

```bash
cd "c:\Users\gabeb\OneDrive\Desktop\vibe code game december\server"
spacetime publish -s http://localhost:3000 vibe-wizard-experience -y --clear-database
```

Then regenerate client bindings:
```bash
cd "c:\Users\gabeb\OneDrive\Desktop\vibe code game december\client"
spacetime generate --lang typescript --out-dir src/generated --project-path ../server
```

---

## Start the Game

### Terminal 1: Start SpacetimeDB Server (WSL)
```bash
wsl -e bash -c "cd /mnt/c/Users/gabeb/OneDrive/Desktop/'vibe code game december'/server && ~/.local/bin/spacetime start"
```

### Terminal 2: Start Client Dev Server
```bash
cd "c:\Users\gabeb\OneDrive\Desktop\vibe code game december\client"
npm run dev
```

### Access the Game
Open your browser to: `http://localhost:5173/`

---

## Database Names Reference

- **Local:** `vibe-wizard-experience` (use with `-s http://localhost:3000`)
- **Vercel/Cloud:** `c20091db4c3087a67e463b95ddaab3bed8914d4288517925554ee9a820c62f5d` (use with `-s maincloud`)

---

## Notes
- Only publish when you change server schema/reducers
- Client dev server auto-reloads on code changes
- Always regenerate bindings after publishing schema changes
