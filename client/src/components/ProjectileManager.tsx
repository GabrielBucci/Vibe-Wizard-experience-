import React, { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

export const ProjectileManager: React.FC<{ projectiles: Map<string, any> }> = ({ projectiles }) => {
    const { scene } = useThree();
    const projectileMeshes = useRef<Map<string, THREE.Mesh>>(new Map());

    // Create a shared geometry and material for performance
    const geometry = useRef(new THREE.SphereGeometry(0.2, 8, 8));
    const material = useRef(new THREE.MeshStandardMaterial({
        color: '#00ffff',
        emissive: '#00ffff',
        emissiveIntensity: 2
    }));

    // Update meshes based on projectile data
    useFrame((state, delta) => {
        // 1. Remove meshes for projectiles that no longer exist
        projectileMeshes.current.forEach((mesh, id) => {
            if (!projectiles.has(id)) {
                scene.remove(mesh);
                projectileMeshes.current.delete(id);
            }
        });

        // 2. Create or Update meshes
        projectiles.forEach((data, id) => {
            // console.log("[DEBUG] ProjectileManager processing:", id, data);
            let mesh = projectileMeshes.current.get(id);

            // Create if new
            if (!mesh) {
                mesh = new THREE.Mesh(geometry.current, material.current);
                mesh.position.set(data.position.x, data.position.y, data.position.z);
                mesh.castShadow = true;
                scene.add(mesh);
                projectileMeshes.current.set(id, mesh);
            }

            // Interpolate position
            const serverPos = new THREE.Vector3(data.position.x, data.position.y, data.position.z);

            // Simple Lerp
            mesh.position.lerp(serverPos, 0.2);

            // Optional: Add some rotation for visual flair
            mesh.rotation.x += delta * 5;
            mesh.rotation.z += delta * 5;
        });
    });

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            projectileMeshes.current.forEach((mesh) => {
                scene.remove(mesh);
            });
            projectileMeshes.current.clear();
        };
    }, [scene]);

    return null; // This component renders directly to the scene via refs
};
