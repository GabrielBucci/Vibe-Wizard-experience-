/**
 * Vibe Coding Starter Pack: 3D Multiplayer - lib.rs
 * 
 * Main entry point for the SpacetimeDB module. This file contains:
 * 
 * 1. Database Schema:
 *    - PlayerData: Active player information
 *    - LoggedOutPlayerData: Persistent data for disconnected players
 *    - GameTickSchedule: Periodic update scheduling
 * 
 * 2. Reducer Functions (Server Endpoints):
 *    - init: Module initialization and game tick scheduling
 *    - identity_connected/disconnected: Connection lifecycle management
 *    - register_player: Player registration with username and character class
 *    - update_player_input: Processes player movement and state updates
 *    - game_tick: Periodic update for game state (scheduled)
 * 
 * 3. Table Structure:
 *    - All tables use Identity as primary keys where appropriate
 *    - Connection between tables maintained through identity references
 * 
 * When modifying:
 *    - Table changes require regenerating TypeScript bindings
 *    - Add `public` tag to tables that need client access
 *    - New reducers should follow naming convention and error handling patterns
 *    - Game logic should be placed in separate modules (like player_logic.rs)
 *    - Extend game_tick for gameplay systems that need periodic updates
 * 
 * Related files:
 *    - common.rs: Shared data structures used in table definitions
 *    - player_logic.rs: Player movement and state update calculations
 */

// Declare modules
mod common;
mod player_logic;
mod physics;

use spacetimedb::{ReducerContext, Identity, Table, Timestamp, ScheduleAt};
use std::time::Duration; // Import standard Duration

// Use items from common module (structs are needed for table definitions)
use crate::common::{Vector3, InputState, PROJECTILE_LIFETIME, PROJECTILE_SPEED, PROJECTILE_DAMAGE};

// --- Schema Definitions ---

#[spacetimedb::table(name = projectile, public)]
#[derive(Clone)]
pub struct ProjectileData {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub owner_identity: Identity,
    pub position: Vector3,
    pub direction: Vector3,
    pub speed: f32,
    pub damage: i32,
    pub lifetime: f32,
    pub start_position: Vector3,
}

#[spacetimedb::table(name = player, public)]
#[derive(Clone)]
pub struct PlayerData {
    #[primary_key]
    identity: Identity,
    username: String,
    character_class: String,
    position: Vector3,
    rotation: Vector3,
    health: i32,
    max_health: i32,
    mana: i32,
    max_mana: i32,
    current_animation: String,
    is_moving: bool,
    is_running: bool,
    is_attacking: bool,
    is_casting: bool,
    last_input_seq: i32,
    input: InputState,
    color: String,
    vertical_velocity: f32,
}

#[spacetimedb::table(name = logged_out_player)]
#[derive(Clone)]
pub struct LoggedOutPlayerData {
    #[primary_key]
    identity: Identity,
    username: String,
    character_class: String,
    position: Vector3,
    rotation: Vector3,
    health: i32,
    max_health: i32,
    mana: i32,
    max_mana: i32,
    last_seen: Timestamp,
}

#[spacetimedb::table(name = game_tick_schedule, public, scheduled(game_tick))]
pub struct GameTickSchedule {
    #[primary_key]
    #[auto_inc]
    scheduled_id: u64,
    scheduled_at: ScheduleAt,
}

// --- Lifecycle Reducers ---

#[spacetimedb::reducer(init)]
pub fn init(ctx: &ReducerContext) -> Result<(), String> {
    spacetimedb::log::info!("[INIT] Initializing Vibe Multiplayer module...");
    if ctx.db.game_tick_schedule().count() == 0 {
        spacetimedb::log::info!("[INIT] Scheduling initial game tick (every 50ms)...");
        let loop_duration = Duration::from_millis(50);
        let schedule = GameTickSchedule {
            scheduled_id: 0,
            scheduled_at: ScheduleAt::Interval(loop_duration.into()),
        };
        match ctx.db.game_tick_schedule().try_insert(schedule) {
            Ok(row) => spacetimedb::log::info!("[INIT] Game tick schedule inserted successfully. ID: {}", row.scheduled_id),
            Err(e) => spacetimedb::log::error!("[INIT] FAILED to insert game tick schedule: {}", e),
        }
    } else {
        spacetimedb::log::info!("[INIT] Game tick already scheduled.");
    }
    Ok(())
}

#[spacetimedb::reducer(client_connected)]
pub fn identity_connected(ctx: &ReducerContext) {
    spacetimedb::log::info!("Client connected: {}", ctx.sender);
    // Player registration/re-joining happens in register_player reducer called by client
}

#[spacetimedb::reducer(client_disconnected)]
pub fn identity_disconnected(ctx: &ReducerContext) {
    let player_identity: Identity = ctx.sender;
    spacetimedb::log::info!("Client disconnected: {}", player_identity);
    let logout_time: Timestamp = ctx.timestamp;

    if let Some(player) = ctx.db.player().identity().find(player_identity) {
        spacetimedb::log::info!("Moving player {} to logged_out_player table.", player_identity);
        let logged_out_player = LoggedOutPlayerData {
            identity: player.identity,
            username: player.username.clone(),
            character_class: player.character_class.clone(),
            position: player.position.clone(),
            rotation: player.rotation.clone(),
            health: player.health,
            max_health: player.max_health,
            mana: player.mana,
            max_mana: player.max_mana,
            last_seen: logout_time,
        };
        ctx.db.logged_out_player().insert(logged_out_player);
        ctx.db.player().identity().delete(player_identity);
    } else {
        spacetimedb::log::warn!("Disconnect by player {} not found in active player table.", player_identity);
        if let Some(mut logged_out_player) = ctx.db.logged_out_player().identity().find(player_identity) {
            logged_out_player.last_seen = logout_time;
            ctx.db.logged_out_player().identity().update(logged_out_player);
            spacetimedb::log::warn!("Updated last_seen for already logged out player {}.", player_identity);
        }
    }
}

// --- Game Specific Reducers ---

#[spacetimedb::reducer]
pub fn register_player(ctx: &ReducerContext, username: String, character_class: String) {
    let player_identity: Identity = ctx.sender;
    spacetimedb::log::info!(
        "Registering player {} ({}) with class {}",
        username,
        player_identity,
        character_class
    );

    if ctx.db.player().identity().find(player_identity).is_some() {
        spacetimedb::log::warn!("Player {} is already active.", player_identity);
        return;
    }

    // Assign color and position based on current player count
    let player_count = ctx.db.player().iter().count();
    let colors = ["cyan", "magenta", "yellow", "lightgreen", "white", "orange"];
    let assigned_color = colors[player_count % colors.len()].to_string();
    // Simple horizontal offset for spawning, start Y at 1.0
    let spawn_position = Vector3 { x: (player_count as f32 * 5.0) - 2.5, y: 1.0, z: 0.0 };

    if let Some(logged_out_player) = ctx.db.logged_out_player().identity().find(player_identity) {
        spacetimedb::log::info!("Player {} is rejoining.", player_identity);
        let default_input = InputState {
            forward: false, backward: false, left: false, right: false,
            sprint: false, jump: false, attack: false, cast_spell: false,
            sequence: 0
        };
        let rejoining_player = PlayerData {
            identity: logged_out_player.identity,
            username: logged_out_player.username.clone(),
            character_class: logged_out_player.character_class.clone(),
            position: spawn_position,
            rotation: logged_out_player.rotation.clone(),
            health: logged_out_player.health,
            max_health: logged_out_player.max_health,
            mana: logged_out_player.mana,
            max_mana: logged_out_player.max_mana,
            current_animation: "idle".to_string(),
            is_moving: false,
            is_running: false,
            is_attacking: false,
            is_casting: false,
            last_input_seq: 0,
            input: default_input,
            color: assigned_color,
            vertical_velocity: 0.0,
        };
        ctx.db.player().insert(rejoining_player);
        ctx.db.logged_out_player().identity().delete(player_identity);
    } else {
        spacetimedb::log::info!("Registering new player {}.", player_identity);
        let default_input = InputState {
            forward: false, backward: false, left: false, right: false,
            sprint: false, jump: false, attack: false, cast_spell: false,
            sequence: 0
        };
        ctx.db.player().insert(PlayerData {
            identity: player_identity,
            username,
            character_class,
            position: spawn_position,
            rotation: Vector3 { x: 0.0, y: 0.0, z: 0.0 },
            health: 100,
            max_health: 100,
            mana: 100,
            max_mana: 100,
            current_animation: "idle".to_string(),
            is_moving: false,
            is_running: false,
            is_attacking: false,
            is_casting: false,
            last_input_seq: 0,
            input: default_input,
            color: assigned_color,
            vertical_velocity: 0.0,
        });
    }
}

#[spacetimedb::reducer]
pub fn update_player_input(
    ctx: &ReducerContext,
    input: InputState,
    client_yaw: f32,
    client_animation: String,
) {
    if let Some(mut player) = ctx.db.player().identity().find(ctx.sender) {
        // store latest yaw (so server movement uses freshest yaw)
        player.rotation.y = client_yaw;

        // update state (server authoritative)
        player_logic::update_input_state(&mut player, input, client_animation);

        // persist
        ctx.db.player().identity().update(player);
    } else {
        spacetimedb::log::warn!("Player {} tried to update input but is not active.", ctx.sender);
    }
}

#[spacetimedb::reducer]
pub fn spawn_projectile(ctx: &ReducerContext) {
    let owner_identity = ctx.sender;

    // 1️⃣ Fetch server-authoritative player data
    let Some(player) = ctx.db.player().identity().find(owner_identity) else {
        spacetimedb::log::warn!(
            "Player {} tried to spawn projectile but is not active.", 
            owner_identity
        );
        return;
    };

    // 2️⃣ Extract yaw
    let yaw = player.rotation.y;

    // 3️⃣ Compute forward vector from yaw (horizontal plane)
    let forward = Vector3 {
        x: yaw.sin(),   // Horizontal X
        y: 0.0,         // No vertical component
        z: yaw.cos(),   // Horizontal Z
    };

    // 4️⃣ Compute right vector perpendicular to forward
    let right = Vector3 {
        x: forward.z,
        y: 0.0,
        z: -forward.x,
    };

    // 5️⃣ Define local muzzle offset (player space)
    // x: sideways, y: up, z: forward
    let muzzle_offset = Vector3 { x: 0.0, y: 1.0, z: 1.0 };

    // 6️⃣ Rotate local offset into world space
    let rotated_offset =
        right * muzzle_offset.x +
        Vector3 { x: 0.0, y: 1.0, z: 0.0 } * muzzle_offset.y +
        forward * muzzle_offset.z;

    // 7️⃣ Compute spawn position
    let spawn_pos = player.position + rotated_offset;

    // 8️⃣ Use forward vector as direction
    let direction_normalized = forward;

    // 9️⃣ Insert projectile into database
    ctx.db.projectile().insert(ProjectileData {
        id: 0, // auto_inc
        owner_identity,
        position: spawn_pos,
        direction: direction_normalized,
        speed: PROJECTILE_SPEED,
        damage: PROJECTILE_DAMAGE,
        lifetime: PROJECTILE_LIFETIME,
        start_position: spawn_pos,
    });

    spacetimedb::log::info!("Player {} spawned a projectile at {:?}", owner_identity, spawn_pos);
}

#[spacetimedb::reducer(update)]
pub fn game_tick(ctx: &ReducerContext, _tick_info: GameTickSchedule) {
    // Just use a simple log message without timestamp conversion
    let delta_time: f32 = 0.050; // 50ms tick rate
    
    // Update Players
    player_logic::update_players_logic(ctx, delta_time as f64);

    // --- Projectile Logic ---
    for mut projectile in ctx.db.projectile().iter() {
        let pos = projectile.position;
        let next_pos = pos + projectile.direction * projectile.speed * delta_time;

        // Collision Detection (Simple distance check against all players)
        let mut hit = false;
        for player in ctx.db.player().iter() {
            if player.identity != projectile.owner_identity {
                // Check distance
                let dist = (player.position - next_pos).length();
                if dist < 1.0 { // Hit radius
                    hit = true;
                    spacetimedb::log::info!("Projectile hit player: {}", player.username);
                    // TODO: Deal damage
                    break;
                }
            }
        }

        if hit || (pos - projectile.start_position).length() > 50.0 { // Max range 50m
            ctx.db.projectile().id().delete(projectile.id);
        } else {
            // Update position
            projectile.position = next_pos;
            ctx.db.projectile().id().update(projectile);
        }
    }
    
    // spacetimedb::log::debug!("Game tick completed");
}
