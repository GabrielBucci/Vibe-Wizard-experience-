/**
 * GameScene.tsx
 * 
 * Core component that manages the 3D multiplayer game environment:
 * 
 * Key functionality:
 * - Acts as the primary container for all 3D game elements
 * - Manages the game world environment (terrain, lighting, physics)
 * - Instantiates and coordinates player entities
 * - Handles multiplayer synchronization across clients
 * - Manages game state and lifecycle (start, join, disconnect)
 * - Maintains socket connections for real-time gameplay
 * 
 * Props:
 * - username: The local player's display name
 * - playerClass: The selected character class for the local player
 * - roomId: Unique identifier for the multiplayer game session
 * - onDisconnect: Callback function when player disconnects from game
 * 
 * Technical implementation:
 * - Uses React Three Fiber (R3F) for 3D rendering within React
 * - Implements physics system with Rapier for realistic interactions
 * - Manages socket.io connections for multiplayer state synchronization
 * - Handles dynamic loading and instantiation of 3D assets
 * 
 * Related files:
 * - Player.tsx: Individual player entity component
 * - JoinGameDialog.tsx: UI for joining a game session
 * - PlayerUI.tsx: In-game user interface elements
 * - Socket handlers for network communication
 */

import React, { useRef, useEffect } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Box, Plane, Grid } from '@react-three/drei';
import * as THREE from 'three';
import { DirectionalLightHelper, CameraHelper } from 'three';
import { ProjectileManager } from './ProjectileManager';
import { PlayerData, InputState, ProjectileData } from '../generated';
import { Identity } from 'spacetimedb';
import { Player } from './Player';

interface GameSceneProps {
  players: ReadonlyMap<string, any>;
  projectiles: Map<string, any>;
  localPlayerIdentity: Identity | null;
  onPlayerRotation?: (rotation: THREE.Euler) => void;
  onHandPositionUpdate?: (position: THREE.Vector3) => void;
  onSpawnProjectile?: () => void;
  currentInputRef?: React.MutableRefObject<any>;
  isDebugPanelVisible?: boolean;
}

// Environment setup component
const SceneEnvironment: React.FC = () => {
  const { scene } = useThree();

  useEffect(() => {
    console.log('🌌 Starting skybox loading...');
    const loader = new THREE.CubeTextureLoader();

    // Define the paths in Three.js's expected order:
    // [+x, -x, +y, -y, +z, -z] (right, left, top, bottom, front, back)
    const paths = [
      '/skybox/corona_ft.png',  // positive x (right)
      '/skybox/corona_bk.png',  // negative x (left)
      '/skybox/corona_up.png',  // positive y (top)
      '/skybox/corona_dn.png',  // negative y (bottom)
      '/skybox/corona_rt.png',  // positive z (front)
      '/skybox/corona_lf.png'   // negative z (back)
    ];

    console.log('🌌 Loading skybox textures in order:', paths);

    // Load the textures
    const texture = loader.load(
      paths,
      (texture) => {
        console.log('🌌 Skybox loaded successfully!');
        scene.background = texture;

        // Set texture parameters for better quality
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
      },
      undefined,
      (error) => {
        console.error('🌌 Error loading skybox:', error);
      }
    );

    return () => {
      if (scene.background instanceof THREE.CubeTexture) {
        scene.background.dispose();
      }
    };
  }, [scene]);

  return (
    <>
      {/* Debug helpers */}
      <axesHelper args={[100]} />
      <gridHelper args={[200, 20]} position={[0, -0.001, 0]} />
    </>
  );
};

export const GameScene: React.FC<GameSceneProps> = ({
  players,
  projectiles,
  localPlayerIdentity,
  onPlayerRotation,
  onHandPositionUpdate,
  onSpawnProjectile,
  currentInputRef,
  isDebugPanelVisible = false
}) => {
  const directionalLightRef = useRef<THREE.DirectionalLight>(null!);

  return (
    <Canvas
      camera={{ position: [0, 10, 20], fov: 60 }}
      style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 1 }}
      shadows
    >
      {/* Add the environment */}
      <SceneEnvironment />

      {/* Ambient light for general scene illumination */}
      <ambientLight intensity={0.5} />

      {/* Main directional light with improved shadow settings */}
      <directionalLight
        ref={directionalLightRef}
        position={[15, 20, 10]}
        intensity={2.5}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-bias={-0.0001}
        shadow-camera-left={-30}
        shadow-camera-right={30}
        shadow-camera-top={30}
        shadow-camera-bottom={-30}
        shadow-camera-near={0.1}
        shadow-camera-far={100}
      />

      {/* Conditionally render Light and Shadow Camera Helpers */}
      {isDebugPanelVisible && directionalLightRef.current && (
        <>
          <primitive object={new DirectionalLightHelper(directionalLightRef.current, 5)} />
          {/* Add CameraHelper for the shadow camera */}
          <primitive object={new CameraHelper(directionalLightRef.current.shadow.camera)} />
        </>
      )}

      {/* Ground Plane (darker, receives shadows) */}
      <Plane
        args={[200, 200]}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.001, 0]}
        receiveShadow={true}
      >
        <meshStandardMaterial color="#606060" />
      </Plane>

      {/* Simplified Grid Helper (mid-gray lines) */}
      <Grid
        position={[0, 0, 0]}
        args={[200, 200]}
        cellSize={2}
        cellThickness={1}
        cellColor={new THREE.Color('#888888')}
      />

      {/* Render Projectiles */}
      <ProjectileManager projectiles={projectiles} />

      {/* Render Players */}
      {Array.from(players.values()).map((player) => {
        const isLocal = localPlayerIdentity?.toHexString() === player.identity.toHexString();
        return (
          <Player
            key={player.identity.toHexString()}
            playerData={player}
            isLocalPlayer={isLocal}
            onRotationChange={isLocal ? onPlayerRotation : undefined}
            onHandPositionUpdate={isLocal ? onHandPositionUpdate : undefined}
            onSpawnProjectile={isLocal ? onSpawnProjectile : undefined}
            currentInput={isLocal ? currentInputRef?.current : undefined}
            isDebugArrowVisible={isLocal ? isDebugPanelVisible : false}
            isDebugPanelVisible={isDebugPanelVisible}
          />
        );
      })}
    </Canvas>
  );
};

