/**
 * Vibe Coding Starter Pack: 3D Multiplayer - lib.rs
 * 
 * Main entry point for the SpacetimeDB module. This file contains:
 * 
 * 1. Database Schema:
 *    - PlayerData: Active player information
 *    - LoggedOutPlayerData: Persistent data for disconnected players
 *    - GameTickSchedule: Periodic update scheduling
 *    - Projectile: Projectile data
 * 
 * 2. Reducer Functions (Server Endpoints):
 *    - init: Module initialization and game tick scheduling
 *    - identity_connected/disconnected: Connection lifecycle management
 *    - register_player: Player registration with username and character class
 *    - update_player_input: Processes player movement and state updates
 *    - game_tick: Periodic update for game state (scheduled)
 *    - cast_projectile: Handles projectile casting
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
mod game_tick;

use spacetimedb::{ReducerContext, Identity, Table, Timestamp, ScheduleAt};
use std::time::Duration; // Import standard Duration

// Use items from common module (structs are needed for table definitions)
use crate::common::{Vector3, InputState, ProjectileData, Quaternion};

// --- Schema Definitions ---

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
    last_input_seq: u32,
    input: InputState,
    color: String,
    last_cast_time: Timestamp, // NEW: Track last spell cast time
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

#[spacetimedb::table(name = game_tick_schedule, public, scheduled(game_tick_update))]
pub struct GameTickSchedule {
    #[primary_key]
    #[auto_inc]
    scheduled_id: u64,
    scheduled_at: ScheduleAt,
}

#[spacetimedb::table(name = projectile, public)]
#[derive(Clone)]
pub struct Projectile {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub data: ProjectileData,
}

// --- Lifecycle Reducers ---

#[spacetimedb::reducer(init)]
pub fn init(ctx: &ReducerContext) -> Result<(), String> {
    spacetimedb::log::info!("[INIT] Initializing Vibe Multiplayer module...");
    if ctx.db.game_tick_schedule().count() == 0 {
        spacetimedb::log::info!("[INIT] Scheduling initial game tick (every 1 second)...");
        let loop_duration = Duration::from_secs(1);
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
            last_cast_time: ctx.timestamp,
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
            last_cast_time: ctx.timestamp,
        });
    }
}

#[spacetimedb::reducer]
pub fn update_player_input(
    ctx: &ReducerContext,
    input: InputState,
    _client_pos: Vector3,
    client_rot: Vector3,
    client_animation: String,
) {
    if let Some(mut player) = ctx.db.player().identity().find(ctx.sender) {
        player_logic::update_input_state(&mut player, input, client_rot, client_animation);
        ctx.db.player().identity().update(player);
    } else {
        spacetimedb::log::warn!("Player {} tried to update input but is not active.", ctx.sender);
    }
}

#[spacetimedb::reducer]
pub fn cast_projectile(
    ctx: &ReducerContext,
    hand_position: Vector3,
    direction: Vector3
) -> Result<(), String> {
    let player_identity = ctx.sender;
    
    // Get the casting player
    let mut player = match ctx.db.player().identity().find(player_identity) {
        Some(p) => p,
        None => return Err("Player not found".to_string())
    };

    // Check cooldown
    let now = ctx.timestamp;
    let cooldown_micros = (common::PROJECTILE_COOLDOWN_SECS * 1_000_000.0) as i64;
    let elapsed_micros = now.to_micros_since_unix_epoch() - player.last_cast_time.to_micros_since_unix_epoch();
    
    if elapsed_micros < cooldown_micros {
        return Err("Spell is on cooldown".to_string());
    }

    // Update player's last cast time and set casting state
    player.last_cast_time = now;
    player.is_casting = true;
    ctx.db.player().identity().update(player);

    // Create the projectile
    let projectile_data = ProjectileData {
        position: hand_position,
        velocity: Vector3 {
            x: direction.x * common::PROJECTILE_SPEED,
            y: direction.y * common::PROJECTILE_SPEED,
            z: direction.z * common::PROJECTILE_SPEED
        },
        rotation: Quaternion { x: 0.0, y: 0.0, z: 0.0, w: 1.0 }, // Default rotation
        caster_identity: player_identity,
        creation_time: now,
        range: common::PROJECTILE_MAX_RANGE,
        damage: common::PROJECTILE_DAMAGE
    };

    // Insert the projectile into the database
    ctx.db.projectile().insert(Projectile {
        id: 0, // Auto-incremented
        data: projectile_data
    });

    Ok(())
}

#[spacetimedb::reducer(update)]
pub fn game_tick_update(ctx: &ReducerContext, _tick_info: GameTickSchedule) {
    // Calculate delta time (1 second between ticks)
    let delta_time = 1.0;
    let current_time = ctx.timestamp;

    // Update projectiles
    game_tick::update_projectiles(ctx, delta_time, current_time);

    // Update players
    for mut player in ctx.db.player().iter() {
        // Reset casting state
        if player.is_casting {
            player.is_casting = false;
            ctx.db.player().identity().update(player.clone());
        }

        // Update player position based on input
        if player.input.forward || player.input.backward || player.input.left || player.input.right {
            let updated_player = player_logic::update_players_logic(ctx, delta_time as f64);
            ctx.db.player().identity().update(player);
        }
    }
}
