/**
 * Vibe Coding Starter Pack: 3D Multiplayer - App.tsx
 * 
 * Main application component that orchestrates the entire multiplayer experience.
 * This file serves as the central hub for:
 * 
 * 1. SpacetimeDB Connection Management:
 *    - Establishes and maintains WebSocket connection
 *    - Handles authentication and identity
 *    - Subscribes to database tables
 *    - Processes real-time updates
 * 
 * 2. Player Input Handling:
 *    - Keyboard and mouse event listeners
 *    - Input state tracking and normalization
 *    - Animation state determination
 *    - Camera/rotation management with pointer lock
 * 
 * 3. Game Loop:
 *    - Sends player input to server at appropriate intervals
 *    - Updates local state based on server responses
 *    - Manages the requestAnimationFrame cycle
 * 
 * 4. UI Management:
 *    - Renders GameScene (3D view)
 *    - Controls DebugPanel visibility
 *    - Manages JoinGameDialog for player registration
 *    - Displays connection status
 * 
 * Extension points:
 *    - Add new input types in currentInputRef and InputState
 *    - Extend determineAnimation for new animation states
 *    - Add new reducers calls for game features (see handleCastSpellInput)
 *    - Modify game loop timing or prediction logic
 * 
 * Related files:
 *    - components/GameScene.tsx: 3D rendering with Three.js
 *    - components/Player.tsx: Character model and animation
 *    - components/DebugPanel.tsx: Developer tools and state inspection
 *    - generated/: Auto-generated TypeScript bindings from the server
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import './App.css';
import { Identity } from 'spacetimedb';
import * as moduleBindings from './generated';
import { DebugPanel } from './components/DebugPanel';
import { GameScene } from './components/GameScene';
import { JoinGameDialog } from './components/JoinGameDialog';
import * as THREE from 'three';
import { PlayerUI } from './components/PlayerUI';

// Type Aliases
type DbConnection = moduleBindings.DbConnection;
type EventContext = moduleBindings.EventContext;
type ErrorContext = moduleBindings.ErrorContext;
type PlayerData = any;
type InputState = any;
// ... other types ...

let conn: DbConnection | null = null;

function App() {
  const [connected, setConnected] = useState(false);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const identityRef = useRef<Identity | null>(null);

  // Sync identity ref
  useEffect(() => {
    identityRef.current = identity;
  }, [identity]);

  const [statusMessage, setStatusMessage] = useState("Connecting...");
  const [players, setPlayers] = useState<ReadonlyMap<string, PlayerData>>(new Map());
  const [projectiles, setProjectiles] = useState<Map<string, any>>(new Map());
  const [localPlayer, setLocalPlayer] = useState<PlayerData | null>(null);
  const localPlayerRef = useRef<PlayerData | null>(null); // Ref to access current player in callbacks

  // Sync ref with state
  useEffect(() => {
    localPlayerRef.current = localPlayer;
  }, [localPlayer]);

  const [showJoinDialog, setShowJoinDialog] = useState(false);
  const [isDebugPanelExpanded, setIsDebugPanelExpanded] = useState(false);
  const [isPointerLocked, setIsPointerLocked] = useState(false); // State for pointer lock status

  // --- Ref for current input state ---
  const currentInputRef = useRef<InputState>({
    forward: false, backward: false, left: false, right: false,
    sprint: false, jump: false, attack: false, castSpell: false,
    sequence: 0,
  });
  const lastSentInputState = useRef<Partial<InputState>>({});
  const animationFrameIdRef = useRef<number | null>(null); // For game loop

  // RTT Tracking
  const inputTimestampsRef = useRef<Map<number, number>>(new Map());

  // New import for handling player rotation data
  const playerRotationRef = useRef<THREE.Euler>(new THREE.Euler(0, 0, 0, 'YXZ'));
  const handPositionRef = useRef<THREE.Vector3>(new THREE.Vector3(0, 0, 0));
  const forwardVectorRef = useRef<THREE.Vector3>(new THREE.Vector3(0, 0, -1));

  // --- Moved Table Callbacks/Subscription Functions Up ---
  const registerTableCallbacks = useCallback(() => {
    if (!conn) return;
    console.log("Registering table callbacks...");

    conn.db.player.onInsert((_ctx: EventContext, player: PlayerData) => {
      console.log("Player inserted (callback):", player.identity.toHexString());
      setPlayers((prev: ReadonlyMap<string, PlayerData>) => new Map(prev).set(player.identity.toHexString(), player));
      if (identityRef.current && player.identity.toHexString() === identityRef.current.toHexString()) {
        setLocalPlayer(player);
        setStatusMessage(`Registered as ${player.username}`);
      }
    });

    conn.db.player.onUpdate((_ctx: EventContext, _oldPlayer: PlayerData, newPlayer: PlayerData) => {
      setPlayers((prev: ReadonlyMap<string, PlayerData>) => {
        const newMap = new Map(prev);
        newMap.set(newPlayer.identity.toHexString(), newPlayer);
        return newMap;
      });
      if (identityRef.current && newPlayer.identity.toHexString() === identityRef.current.toHexString()) {
        setLocalPlayer(newPlayer);

        // RTT Calculation Debugging
        // console.log(`[RTT DEBUG] Update received. Seq: ${newPlayer.lastInputSeq}, Pending: ${inputTimestampsRef.current.size}`);
        // console.log("[RTT DEBUG] Full Player Object:", JSON.stringify(newPlayer)); // Log full object to check fields

        if (newPlayer.lastInputSeq) {
          const sentTime = inputTimestampsRef.current.get(newPlayer.lastInputSeq);
          if (sentTime) {
            const rtt = performance.now() - sentTime;

            // Store RTT for stats
            const win = window as any;
            if (!win.rttSamples) win.rttSamples = [];
            win.rttSamples.push(rtt);

            // Log high latency immediately
            if (rtt > 200) {
              console.warn(`[NETWORK LAG] High RTT: ${rtt.toFixed(0)}ms for seq ${newPlayer.lastInputSeq}`);
            }

            // Cleanup old timestamps
            inputTimestampsRef.current.delete(newPlayer.lastInputSeq);
            if (inputTimestampsRef.current.size > 100) {
              const oldestSeq = newPlayer.lastInputSeq - 100;
              inputTimestampsRef.current.delete(oldestSeq);
            }
          } else {
            // Log if we received a sequence we aren't waiting for (or already processed)
            console.warn(`[RTT DEBUG] Received seq ${newPlayer.lastInputSeq} but no timestamp found!`);
          }
        } else {
          // Log if lastInputSeq is missing or 0
          console.warn(`[RTT DEBUG] newPlayer.lastInputSeq is missing or 0:`, newPlayer.lastInputSeq);
        }
      }
    });

    conn.db.player.onDelete((_ctx: EventContext, player: PlayerData) => {
      console.log("Player deleted (callback):", player.identity.toHexString());
      setPlayers((prev: ReadonlyMap<string, PlayerData>) => {
        const newMap = new Map(prev);
        newMap.delete(player.identity.toHexString());
        return newMap;
      });
      if (identityRef.current && player.identity.toHexString() === identityRef.current.toHexString()) {
        setLocalPlayer(null);
        setStatusMessage("Local player deleted!");
      }
    });

    // --- Projectile Callbacks ---
    conn.db.projectile.onInsert((_ctx: EventContext, projectile: any) => {
      setProjectiles((prev) => new Map(prev).set(projectile.id.toString(), projectile));
    });

    conn.db.projectile.onUpdate((_ctx: EventContext, _oldProjectile: any, newProjectile: any) => {
      setProjectiles((prev) => new Map(prev).set(newProjectile.id.toString(), newProjectile));
    });

    conn.db.projectile.onDelete((_ctx: EventContext, projectile: any) => {
      setProjectiles((prev) => {
        const newMap = new Map(prev);
        newMap.delete(projectile.id.toString());
        return newMap;
      });
    });

    console.log("Table callbacks registered.");
  }, []); // No dependency on identity needed

  const onSubscriptionApplied = useCallback(() => {
    console.log("Subscription applied successfully.");
    setPlayers((prev: ReadonlyMap<string, PlayerData>) => {
      if (prev.size === 0 && conn) {
        const currentPlayers = new Map<string, PlayerData>();
        for (const player of conn.db.player.iter()) {
          currentPlayers.set(player.identity.toHexString(), player);
          if (identityRef.current && player.identity.toHexString() === identityRef.current.toHexString()) {
            setLocalPlayer(player);
          }
        }
        return currentPlayers;
      }
      return prev;
    });

    // Initial Projectile Load
    if (conn) {
      const currentProjectiles = new Map<string, any>();
      for (const projectile of conn.db.projectile.iter()) {
        currentProjectiles.set(projectile.id.toString(), projectile);
      }
      setProjectiles(currentProjectiles);
    }
  }, []); // No dependency on identity needed

  const onSubscriptionError = useCallback((error: any) => {
    console.error("Subscription error:", error);
    setStatusMessage(`Subscription Error: ${error?.message || error}`);
  }, []);

  const subscribeToTables = useCallback(() => {
    if (!conn) return;
    console.log("Subscribing to tables...");
    const subscription = conn.subscriptionBuilder();
    subscription.subscribe("SELECT * FROM player");
    subscription.subscribe("SELECT * FROM projectile");
    subscription.onApplied(onSubscriptionApplied);
    subscription.onError(onSubscriptionError);
  }, [identity, onSubscriptionApplied, onSubscriptionError]); // Add dependencies

  // --- Event Handlers ---
  const handleDelegatedClick = useCallback((event: MouseEvent) => {
    const button = (event.target as HTMLElement).closest('.interactive-button');
    if (button) {
      event.preventDefault();
      console.log(`[CLIENT] Button click detected: ${button.getAttribute('data-action')}`);
      // Generic button handler without specific attack functionality
    }
  }, []);

  // --- Input State Management ---
  const keyMap: { [key: string]: keyof Omit<InputState, 'sequence' | 'castSpell'> } = {
    KeyW: 'forward', KeyS: 'backward', KeyA: 'left', KeyD: 'right',
    ShiftLeft: 'sprint', Space: 'jump',
  };

  const determineAnimation = useCallback((input: InputState): string => {
    if (input.attack) return 'attack1';
    if (input.castSpell) return 'cast';
    if (input.jump) return 'jump';

    // Determine animation based on movement keys
    const { forward, backward, left, right, sprint } = input;
    const isMoving = forward || backward || left || right;

    if (!isMoving) return 'idle';

    // Improved direction determination with priority handling
    // This matches legacy implementation better
    let direction = 'forward';

    // Primary direction determination - match legacy player.js logic
    if (forward && !backward) {
      direction = 'forward';
    } else if (backward && !forward) {
      direction = 'back';
    } else if (left && !right) {
      direction = 'left';
    } else if (right && !left) {
      direction = 'right';
    } else if (forward && left) {
      // Handle diagonal movement by choosing dominant direction
      direction = 'left';
    } else if (forward && right) {
      direction = 'right';
    } else if (backward && left) {
      direction = 'left';
    } else if (backward && right) {
      direction = 'right';
    }

    // Choose movement type based on sprint state
    const moveType = sprint ? 'run' : 'walk';

    // Generate final animation name
    const animationName = `${moveType}-${direction}`;

    return animationName;
  }, []);

  const sendInput = useCallback((currentInputState: InputState) => {
    if (!conn || !identity || !connected) return; // Check connection status too

    // Create InputState with exact field order matching generated TypeScript bindings
    // The bindings auto-convert camelCase to snake_case for Rust
    const safeInputState = {
      forward: !!currentInputState.forward,
      backward: !!currentInputState.backward,
      left: !!currentInputState.left,
      right: !!currentInputState.right,
      sprint: !!currentInputState.sprint,
      jump: !!currentInputState.jump,
      attack: !!currentInputState.attack,
      castSpell: !!currentInputState.castSpell,
      sequence: currentInputState.sequence || 0,
    };

    // Determine animation from input state
    const currentAnimation = determineAnimation(safeInputState);

    let changed = false;
    for (const key in safeInputState) {
      if (safeInputState[key] !== lastSentInputState.current[key]) {
        changed = true;
        break;
      }
    }

    if (changed || safeInputState.sequence !== lastSentInputState.current.sequence) {
      // Fortnite-style: Send yaw only
      const yawToSend = playerRotationRef.current.y ?? 0;

      // Debug logging & RTT Stats
      if (safeInputState.sequence % 60 === 0) { // Log every second
        let rttStats = "RTT: Waiting...";
        const win = window as any;
        if (win.rttSamples && win.rttSamples.length > 0) {
          const avg = win.rttSamples.reduce((a: number, b: number) => a + b, 0) / win.rttSamples.length;
          const max = Math.max(...win.rttSamples);
          const min = Math.min(...win.rttSamples);
          rttStats = `RTT Avg: ${avg.toFixed(0)}ms | Min: ${min.toFixed(0)}ms | Max: ${max.toFixed(0)}ms`;
          win.rttSamples = []; // Reset samples
        }
        console.log(`[NET STATS] Seq: ${safeInputState.sequence} | ${rttStats}`);
      }

      // Record timestamp for RTT calculation
      inputTimestampsRef.current.set(safeInputState.sequence, performance.now());

      conn.reducers.updatePlayerInput({
        input: safeInputState,
        clientYaw: yawToSend,
        forwardVector: {
          x: forwardVectorRef.current.x,
          y: forwardVectorRef.current.y,
          z: forwardVectorRef.current.z
        },
        clientAnimation: currentAnimation
      });
      lastSentInputState.current = { ...safeInputState };
    }
  }, [identity, localPlayer, connected, determineAnimation]);

  // Add player rotation handler
  const handleHandPositionUpdate = useCallback((position: THREE.Vector3) => {
    handPositionRef.current.copy(position);
  }, []);

  // --- Projectile Spawn Handler ---
  const handleSpawnProjectile = useCallback(() => {
    if (conn && handPositionRef.current) {
      // Create a plain object to ensure SpacetimeDB serialization works
      const spawnPos = {
        x: handPositionRef.current.x,
        y: handPositionRef.current.y,
        z: handPositionRef.current.z
      };

      // @ts-ignore
      conn.reducers.spawnProjectile({ handPosition: spawnPos });
    } else {
      console.warn("[DEBUG] Cannot spawn projectile: conn missing or handPositionRef invalid", { conn: !!conn, handPos: handPositionRef.current });
    }
  }, []);

  

  const handleForwardVectorUpdate = useCallback((forward: THREE.Vector3) => {
    forwardVectorRef.current.copy(forward);
  }, []);

  const handlePlayerRotation = useCallback((rotation: THREE.Euler) => {
    // Update our stored rotation whenever the player rotates (from mouse movements)
    playerRotationRef.current.copy(rotation);
  }, []);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (event.repeat) return;
    const action = keyMap[event.code];
    if (action) {
      if (!currentInputRef.current[action]) {
        currentInputRef.current[action] = true;
      }
    }
  }, []);

  const handleKeyUp = useCallback((event: KeyboardEvent) => {
    const action = keyMap[event.code];
    if (action) {
      if (currentInputRef.current[action]) {
        currentInputRef.current[action] = false;
      }
    }
  }, []);

  const handleMouseDown = useCallback((event: MouseEvent) => {
    if (event.button === 0) {
      // Trigger Attack Animation locally
      if (!currentInputRef.current.attack) {
        currentInputRef.current.attack = true;
        setTimeout(() => {
          currentInputRef.current.attack = false;
        }, 2000);
      }

      // Note: Projectile spawn is now triggered by animation callback via handleSpawnProjectile
    }
  }, []);

  // --- Debug Input Listeners ---
  useEffect(() => {
    const debugMouseDown = () => console.log("[DEBUG] Global mousedown detected");
    const debugKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'KeyF') {
        console.log("[DEBUG] F key pressed -> Triggering manual cast");
        // Trigger Cast Animation locally
        if (!currentInputRef.current.castSpell) {
          currentInputRef.current.castSpell = true;
          setTimeout(() => {
            currentInputRef.current.castSpell = false;
          }, 2000);
        }
      }
    };

    window.addEventListener('mousedown', debugMouseDown);
    window.addEventListener('keydown', debugKeyDown);
    return () => {
      window.removeEventListener('mousedown', debugMouseDown);
      window.removeEventListener('keydown', debugKeyDown);
    };
  }, []);

  const handleMouseUp = useCallback((event: MouseEvent) => {
    // No longer need to clear attack on mouse up
    // Attack is auto-cleared by setTimeout in handleMouseDown
  }, []);

  // Mouse move handler removed - Player.tsx now handles all camera rotation logic
  // and updates App.tsx via the onPlayerRotation callback.

  // --- Listener Setup/Removal Functions ---
  const handlePointerLockChange = useCallback(() => {
    setIsPointerLocked(document.pointerLockElement === document.body);
    // console.log("Pointer Lock Changed: ", document.pointerLockElement === document.body);
  }, []);

  // --- Input Listeners Effect ---
  useEffect(() => {
    if (!connected) return;

    const onKeyDown = (e: KeyboardEvent) => handleKeyDown(e);
    const onKeyUp = (e: KeyboardEvent) => handleKeyUp(e);
    const onMouseDown = (e: MouseEvent) => handleMouseDown(e);
    const onMouseUp = (e: MouseEvent) => handleMouseUp(e);
    const onPointerLockChange = () => handlePointerLockChange();

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    document.addEventListener('pointerlockchange', onPointerLockChange);

    console.log("Input listeners attached via useEffect");

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('pointerlockchange', onPointerLockChange);
      console.log("Input listeners detached via useEffect");
    };
  }, [connected, handleKeyDown, handleKeyUp, handleMouseDown, handleMouseUp, handlePointerLockChange]);

  // --- Delegated Listeners Effect ---
  useEffect(() => {
    if (!connected) return;
    document.body.addEventListener('click', handleDelegatedClick, true);
    return () => {
      document.body.removeEventListener('click', handleDelegatedClick, true);
    };
  }, [connected, handleDelegatedClick]);

  // --- Game Loop Effect (60Hz Input Sending) ---
  useEffect(() => {
    if (!connected || !conn || !identity) return;

    console.log("[CLIENT] Starting 60Hz input sender.");

    const SEND_TICK_MS = 1000 / 60; // 60Hz
    const intervalId = setInterval(() => {
      if (!conn || !identity || !connected) return;

      currentInputRef.current.sequence += 1;
      sendInput(currentInputRef.current);
    }, SEND_TICK_MS);

    return () => {
      console.log("[CLIENT] Stopping input sender.");
      clearInterval(intervalId);
    };
  }, [connected, conn, identity, sendInput]);

  // --- Connection Effect Hook ---
  useEffect(() => {
    console.log("Running Connection Effect Hook...");
    if (conn) {
      console.log("Connection already established, skipping setup.");
      return;
    }

    // Get connection config from environment variables with fallbacks for local dev
    const dbHost = import.meta.env.VITE_SPACETIME_HOST || "localhost:3000";
    const dbName = import.meta.env.VITE_SPACETIME_MODULE_NAME || "vibe-wizard-experience";

    // Determine protocol based on host (https for production, ws for local)
    const protocol = dbHost.includes('maincloud.spacetimedb.com') ? 'https' : 'ws';
    const wsUrl = `${protocol}://${dbHost}`;

    console.log(`Connecting to SpacetimeDB at ${wsUrl}, database: ${dbName}...`);

    const onConnect = (connection: DbConnection, id: Identity, _token: string) => {
      console.log("Connected!");
      conn = connection;
      setIdentity(id);
      setConnected(true);
      setStatusMessage(`Connected as ${id.toHexString().substring(0, 8)}...`);
      subscribeToTables();
      registerTableCallbacks();
      setShowJoinDialog(true);
    };

    const onDisconnect = (_ctx: ErrorContext, reason?: Error | null) => {
      const reasonStr = reason ? reason.message : "No reason given";
      console.log("onDisconnect triggered:", reasonStr);
      setStatusMessage(`Disconnected: ${reasonStr}`);
      conn = null;
      setIdentity(null);
      setConnected(false);
      setPlayers(new Map());
      setLocalPlayer(null);
    };

    moduleBindings.DbConnection.builder()
      .withUri(wsUrl)
      .withModuleName(dbName)
      .withToken(null) // Explicitly enable anonymous access
      .onConnect(onConnect)
      .onDisconnect(onDisconnect)
      .build();

    return () => {
      console.log("Cleaning up connection effect.");
    };
  }, []);

  // --- handleJoinGame ---
  const handleJoinGame = (username: string, characterClass: string) => {
    if (!conn) {
      console.error("Cannot join game, not connected.");
      return;
    }
    console.log(`Registering as ${username} (${characterClass})...`);
    // @ts-ignore
    conn.reducers.registerPlayer(username, characterClass);
    setShowJoinDialog(false);
  };

  // --- Render Logic ---
  return (
    <div className="App" style={{ width: '100vw', height: '100vh', position: 'relative' }}>
      {showJoinDialog && <JoinGameDialog onJoin={handleJoinGame} />}

      {/* Conditionally render DebugPanel based on connection status */}
      {/* Visibility controlled internally, expansion controlled by state */}
      {connected && (
        <DebugPanel
          statusMessage={statusMessage}
          localPlayer={localPlayer}
          identity={identity}
          playerMap={players}
          expanded={isDebugPanelExpanded}
          onToggleExpanded={() => setIsDebugPanelExpanded((prev: boolean) => !prev)}
          isPointerLocked={isPointerLocked} // Pass pointer lock state down
        />
      )}

      {/* Always render GameScene and PlayerUI when connected */}
      {connected && (
        <>
          <GameScene
            players={players}
            projectiles={projectiles}
            localPlayerIdentity={identity}
            onPlayerRotation={handlePlayerRotation}
            onHandPositionUpdate={handleHandPositionUpdate}
            onSpawnProjectile={handleSpawnProjectile}
            onForwardVectorUpdate={handleForwardVectorUpdate}
            currentInputRef={currentInputRef}
            isDebugPanelVisible={isDebugPanelExpanded}
          />
          {/* Render PlayerUI only if localPlayer exists */}
          {localPlayer && <PlayerUI playerData={localPlayer} />}
        </>
      )}

      {/* Show status when not connected */}
      {!connected && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}><h1>{statusMessage}</h1></div>
      )}
    </div>
  );
}

export default App;
