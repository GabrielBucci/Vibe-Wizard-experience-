use spacetimedb::{ReducerContext, Identity, Timestamp, Table};
use crate::{Projectile, PlayerData, projectile, player};
use crate::common::{Vector3, PROJECTILE_SPEED, PROJECTILE_MAX_RANGE, PROJECTILE_DAMAGE};

pub fn update_projectiles(ctx: &ReducerContext, delta_time: f32, current_time: Timestamp) {
    let mut projectiles_to_delete = Vec::new();

    for mut projectile_row in ctx.db.projectile().iter() {
        let mut projectile = projectile_row.data.clone();

        // 1. Update position based on velocity
        projectile.position.x += projectile.velocity.x * delta_time;
        projectile.position.y += projectile.velocity.y * delta_time;
        projectile.position.z += projectile.velocity.z * delta_time;

        // 2. Check Range/Lifetime
        let elapsed_time = (current_time.to_micros_since_unix_epoch() - projectile.creation_time.to_micros_since_unix_epoch()) as f32 / 1_000_000.0;
        if elapsed_time * PROJECTILE_SPEED > projectile.range {
             projectiles_to_delete.push(projectile_row.id);
             continue;
        }

        // 3. Collision Detection (Simple Sphere-Player collision)
        for mut player in ctx.db.player().iter() {
            // Don't hit the caster
            if player.identity == projectile.caster_identity {
                continue;
            }

            // Simplified collision: distance check (assuming player is a sphere)
            let player_radius = 0.5; // Approx player collision radius
            let projectile_radius = 0.2; // Approx projectile collision radius
            let combined_radius_sq = (player_radius + projectile_radius) * (player_radius + projectile_radius);

            let dist_sq = (player.position.x - projectile.position.x) * (player.position.x - projectile.position.x) +
                         (player.position.y - projectile.position.y) * (player.position.y - projectile.position.y) +
                         (player.position.z - projectile.position.z) * (player.position.z - projectile.position.z);

            if dist_sq < combined_radius_sq {
                // Hit! Apply damage
                player.health = player.health.saturating_sub(projectile.damage as i32);
                player.current_animation = "damage".to_string();

                // Update player in DB
                ctx.db.player().identity().update(player.clone());
                spacetimedb::log::info!(
                    "Projectile hit Player {} for {} damage. New health: {}", 
                    player.identity, 
                    projectile.damage, 
                    player.health
                );

                // Mark projectile for deletion
                projectiles_to_delete.push(projectile_row.id);
                break;
            }
        }

        // Update the projectile's data in the database if not marked for deletion
        if !projectiles_to_delete.contains(&projectile_row.id) {
            projectile_row.data = projectile;
            ctx.db.projectile().id().update(projectile_row);
        }
    }

    // Delete projectiles marked for deletion
    for id in projectiles_to_delete {
        ctx.db.projectile().id().delete(id);
        spacetimedb::log::info!("Deleted projectile {}", id);
    }
} 