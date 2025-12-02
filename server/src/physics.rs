use crate::common::{Vector3, PLAYER_RADIUS, PLAYER_HEIGHT, PROJECTILE_RADIUS};

pub fn check_collision(player_pos: &Vector3, projectile_pos: &Vector3) -> bool {
    // 1. Clamp projectile Y to be within the player's vertical range (Cylinder)
    let player_bottom = player_pos.y;
    let player_top = player_pos.y + PLAYER_HEIGHT;
    
    // Find the closest point on the player's vertical axis to the projectile
    let closest_y = projectile_pos.y.max(player_bottom).min(player_top);

    // 2. Calculate distance squared between projectile and that closest point
    let dx = projectile_pos.x - player_pos.x;
    let dy = projectile_pos.y - closest_y;
    let dz = projectile_pos.z - player_pos.z;

    let distance_sq = dx * dx + dy * dy + dz * dz;

    // 3. Check if distance is less than sum of radii
    let hit_radius = PLAYER_RADIUS + PROJECTILE_RADIUS;
    
    distance_sq <= (hit_radius * hit_radius)
}
