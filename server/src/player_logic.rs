/**
 * Vibe Coding Starter Pack: 3D Multiplayer - player_logic.rs
 * 
 * This file contains the core movement and player state update logic.
 * It's separated from lib.rs to improve modularity and maintainability.
 * 
 * Key components:
 * 
 * 1. Movement Calculation:
 *    - calculate_new_position: Computes player movement based on input and rotation
 *    - Vector math for converting input to movement direction
 *    - Direction normalization and speed application
 * 
 * 2. State Management:
 *    - update_input_state: Updates player state based on client input
 *    - Handles position, animation, and derived state (is_moving, is_running)
 *    - Translates raw input to game state
 * 
 * 3. Game Tick:
 *    - update_players_logic: Placeholder for periodic player updates
 *    - Currently empty as players are updated directly through input
 *    - Can be extended for server-side simulation (AI, physics, etc.)
 * 
 * Extension points:
 *    - Add terrain logic for realistic height adjustments
 *    - Implement server-side animation determination (commented example provided)
 *    - Add collision detection in calculate_new_position
 *    - Expand update_players_logic for server-side gameplay mechanics
 * 
 * Related files:
 *    - common.rs: Provides shared data types and constants
 *    - lib.rs: Calls into this module's functions from reducers
 */

use spacetimedb::ReducerContext;
// Import common structs and constants
use crate::common::{Vector3, InputState, PLAYER_SPEED, SPRINT_MULTIPLIER, GRAVITY, JUMP_FORCE};
// Import the PlayerData struct definition (assuming it's in lib.rs or common.rs)
use crate::PlayerData;

// Fortnite-style movement calculation using yaw only, with vertical velocity in PlayerData
pub fn calculate_new_position(
    player: &mut PlayerData,
    yaw: f32,
    input: &InputState,
    delta_time: f32,
    prev_jump: bool
) -> Vector3 {
    // If nothing to do and grounded, fast-exit
    let has_movement_input = input.forward || input.backward || input.left || input.right;
    if !has_movement_input && !input.jump && player.position.y <= 0.0 {
        return player.position.clone();
    }

    // speed
    let speed = if input.sprint { PLAYER_SPEED * SPRINT_MULTIPLIER } else { PLAYER_SPEED };

    // Build forward/right from yaw (convention: forward is -z)
    let cos_yaw = yaw.cos();
    let sin_yaw = yaw.sin();

    let forward = Vector3 { x: -sin_yaw, y: 0.0, z: -cos_yaw };
    let right   = Vector3 { x:  cos_yaw, y: 0.0, z: -sin_yaw };

    // accumulate horizontal movement vector
    let mut dir = Vector3 { x: 0.0, y: 0.0, z: 0.0 };
    if input.forward  { dir.x += forward.x; dir.z += forward.z; }
    if input.backward { dir.x -= forward.x; dir.z -= forward.z; }
    if input.right    { dir.x += right.x;   dir.z += right.z;   }
    if input.left     { dir.x -= right.x;   dir.z -= right.z;   }

    // normalize horizontal component
    let mag = (dir.x * dir.x + dir.z * dir.z).sqrt();
    if mag > 0.01 {
        dir.x /= mag;
        dir.z /= mag;
    }

    // scale by speed and delta
    dir.x *= speed * delta_time;
    dir.z *= speed * delta_time;

    // apply horizontal movement to position
    let mut new_pos = player.position.clone();
    new_pos.x += dir.x;
    new_pos.z += dir.z;

    // --- Vertical movement: gravity & jump ---
    // player.vertical_velocity is stored in PlayerData
    player.vertical_velocity += GRAVITY * delta_time;

    // Jump impulse (rising edge: input.jump true now, but prev_jump false)
    if input.jump && !prev_jump && player.position.y <= 0.01 {
        player.vertical_velocity = JUMP_FORCE;
    }

    // Apply vertical velocity
    new_pos.y += player.vertical_velocity * delta_time;

    // Ground collision and clamp
    if new_pos.y <= 0.0 {
        new_pos.y = 0.0;
        player.vertical_velocity = 0.0;
    }

    new_pos
}

// Note: Animation determination is currently handled client-side
// You could implement server-side animation logic here if needed
// For example:
// pub fn determine_animation(input: &InputState) -> String {
//     let is_moving = input.forward || input.backward || input.left || input.right;
//     if input.attack { return "attack1".to_string(); }
//     if input.jump { return "jump".to_string(); }
//     if is_moving {
//         if input.sprint { "run-forward".to_string() }
//         else { "walk-forward".to_string() }
//     } else {
//         "idle".to_string()
//     }
// }

// Update player state based on input (server authoritative)
pub fn update_input_state(player: &mut PlayerData, input: InputState, client_animation: String) {
    // Server tick delta (kept consistent across server)
    let delta_time_estimate: f32 = 1.0 / 60.0;

    // Use server-stored yaw (player.rotation.y) which was set from client_yaw
    let yaw = player.rotation.y;

    // Previous jump input (for rising edge detection)
    let prev_jump = player.input.jump;

    // Compute new authoritative position
    let new_position = calculate_new_position(
        player,
        yaw,
        &input,
        delta_time_estimate,
        prev_jump
    );

    // Persist authoritative results
    player.position = new_position;
    player.current_animation = client_animation;
    player.input = input.clone();
    player.last_input_seq = input.sequence;

    // flags
    player.is_moving = input.forward || input.backward || input.left || input.right;
    player.is_running = player.is_moving && input.sprint;
    player.is_attacking = input.attack;
    player.is_casting = input.cast_spell;
}

// Update players logic (called from game_tick)
pub fn update_players_logic(_ctx: &ReducerContext, _delta_time: f64) {
    // In the simplified starter pack, we don't need to do anything in the game tick
    // for players as they're updated directly through the update_player_input reducer
    // This function is a placeholder for future expansion
}
