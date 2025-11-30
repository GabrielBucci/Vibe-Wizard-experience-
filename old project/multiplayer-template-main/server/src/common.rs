/**
 * Vibe Coding Starter Pack: 3D Multiplayer - common.rs
 * 
 * This file contains shared data structures and constants used throughout the application.
 * 
 * Key components:
 * - Vector3: 3D vector struct for positions, rotations and movement
 * - InputState: Player input tracking with all possible input actions
 * - Game constants: Speed values that affect player movement
 * 
 * These structures are used by:
 * - lib.rs: For database table definitions
 * - player_logic.rs: For movement calculations and state updates
 * 
 * When modifying:
 * - Changes to Vector3 or InputState will affect database schema
 * - You may need to run 'spacetime delete <db_name>' after schema changes
 * - Adjust PLAYER_SPEED and SPRINT_MULTIPLIER to change movement feel
 * - Adding new input types requires updates to InputState and UI event handlers
 */

use spacetimedb::{SpacetimeType, Identity, Timestamp};

// --- Shared Structs ---

// Helper struct for 3D vectors
#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub struct Vector3 {
    pub x: f32,
    pub y: f32,
    pub z: f32,
}

// Helper struct for player input state
#[derive(SpacetimeType, Clone, Debug)]
pub struct InputState {
    pub forward: bool,
    pub backward: bool,
    pub left: bool,
    pub right: bool,
    pub sprint: bool,
    pub jump: bool,
    pub attack: bool,
    pub cast_spell: bool,
    pub sequence: u32,
}

// Helper struct for quaternion rotations
#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub struct Quaternion {
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub w: f32,
}

// Projectile data structure
#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub struct ProjectileData {
    pub position: Vector3,
    pub velocity: Vector3,
    pub rotation: Quaternion,
    pub caster_identity: Identity,
    pub creation_time: Timestamp,
    pub range: f32,
    pub damage: u32,
}

// --- Game Constants ---

// Player movement constants
pub const PLAYER_SPEED: f32 = 7.5;
pub const SPRINT_MULTIPLIER: f32 = 1.8;

// Projectile constants
pub const PROJECTILE_SPEED: f32 = 20.0;
pub const PROJECTILE_MAX_RANGE: f32 = 30.0;
pub const PROJECTILE_DAMAGE: u32 = 20;
pub const PROJECTILE_COOLDOWN_SECS: f32 = 0.8;

// --- Vector3 Implementation ---

impl Vector3 {
    pub fn normalize(&self) -> Self {
        let mag = (self.x.powi(2) + self.y.powi(2) + self.z.powi(2)).sqrt();
        if mag > 0.0001 {
            Vector3 {
                x: self.x / mag,
                y: self.y / mag,
                z: self.z / mag,
            }
        } else {
            Vector3 { x: 0.0, y: 0.0, z: 0.0 }
        }
    }
}

// --- Quaternion Utilities ---

pub fn quaternion_from_to_rotation(from: &Vector3, to: &Vector3) -> Quaternion {
    let dot = from.x * to.x + from.y * to.y + from.z * to.z;
    let cross = Vector3 {
        x: from.y * to.z - from.z * to.y,
        y: from.z * to.x - from.x * to.z,
        z: from.x * to.y - from.y * to.x,
    };

    if dot > 0.999999 { // Vectors are almost parallel
        return Quaternion { x: 0.0, y: 0.0, z: 0.0, w: 1.0 };
    }
    if dot < -0.999999 { // Vectors are almost opposite (180 degree rotation)
        // Pick an arbitrary axis perpendicular to `from`
        let axis = if from.x.abs() < 0.8 {
            Vector3 { x: 1.0, y: 0.0, z: 0.0 }
        } else {
            Vector3 { x: 0.0, y: 1.0, z: 0.0 }
        };
        let axis_cross = Vector3 {
            x: from.y * axis.z - from.z * axis.y,
            y: from.z * axis.x - from.x * axis.z,
            z: from.x * axis.y - from.y * axis.x,
        };
        let axis_magnitude = (axis_cross.x.powi(2) + axis_cross.y.powi(2) + axis_cross.z.powi(2)).sqrt();
        let axis_normalized = Vector3 {
            x: axis_cross.x / axis_magnitude,
            y: axis_cross.y / axis_magnitude,
            z: axis_cross.z / axis_magnitude,
        };
        return Quaternion {
            x: axis_normalized.x * (std::f32::consts::PI / 2.0).sin(),
            y: axis_normalized.y * (std::f32::consts::PI / 2.0).sin(),
            z: axis_normalized.z * (std::f32::consts::PI / 2.0).sin(),
            w: (std::f32::consts::PI / 2.0).cos(),
        };
    }

    let s = (2.0 * (1.0 + dot)).sqrt();
    let inv_s = 1.0 / s;

    Quaternion {
        x: cross.x * inv_s,
        y: cross.y * inv_s,
        z: cross.z * inv_s,
        w: 0.5 * s,
    }
}
