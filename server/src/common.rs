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

use spacetimedb::{SpacetimeType};

// --- Shared Structs ---

// Helper struct for 3D vectors
#[derive(SpacetimeType, Clone, Copy, Debug, PartialEq)]
pub struct Vector3 {
    pub x: f32,
    pub y: f32,
    pub z: f32,
}

impl Vector3 {
    pub fn length(&self) -> f32 {
        (self.x * self.x + self.y * self.y + self.z * self.z).sqrt()
    }

    pub fn normalize(&self) -> Vector3 {
        let len = self.length();
        if len > 0.0 {
            Vector3 {
                x: self.x / len,
                y: self.y / len,
                z: self.z / len,
            }
        } else {
            *self
        }
    }
}

impl std::ops::Add for Vector3 {
    type Output = Vector3;
    fn add(self, other: Vector3) -> Vector3 {
        Vector3 {
            x: self.x + other.x,
            y: self.y + other.y,
            z: self.z + other.z,
        }
    }
}

impl std::ops::Sub for Vector3 {
    type Output = Vector3;
    fn sub(self, other: Vector3) -> Vector3 {
        Vector3 {
            x: self.x - other.x,
            y: self.y - other.y,
            z: self.z - other.z,
        }
    }
}

impl std::ops::Mul<f32> for Vector3 {
    type Output = Vector3;
    fn mul(self, scalar: f32) -> Vector3 {
        Vector3 {
            x: self.x * scalar,
            y: self.y * scalar,
            z: self.z * scalar,
        }
    }
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
    pub cast_spell: bool, // server field; TS will map to castSpell
    pub sequence: i32,
}

// --- Game Constants ---

pub const PLAYER_SPEED: f32 = 15.0;        // authoritative
pub const SPRINT_MULTIPLIER: f32 = 1.8;
pub const GRAVITY: f32 = -6.0;
pub const JUMP_FORCE: f32 = 9.0;

// --- Projectile Constants ---
pub const PROJECTILE_SPEED: f32 = 15.0;
pub const PROJECTILE_DAMAGE: i32 = 10;
pub const PROJECTILE_LIFETIME: f32 = 5.0; // seconds
pub const PROJECTILE_RADIUS: f32 = 0.2;
pub const PLAYER_RADIUS: f32 = 0.5;
pub const PLAYER_HEIGHT: f32 = 2.0;

// Helper struct for Projectile state
#[derive(SpacetimeType, Clone, Debug)]
pub struct Projectile {
    pub owner_identity: spacetimedb::Identity,
    pub direction: Vector3,
    pub speed: f32,
    pub damage: i32,
    pub lifetime: f32,
}
