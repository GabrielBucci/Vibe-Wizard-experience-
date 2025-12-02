/**
 * Player.tsx
 * 
 * Component responsible for rendering and controlling individual player entities:
 * 
 * Key functionality:
 * - Handles 3D character model rendering with appropriate animations
 * - Implements physics-based player movement and collision detection
 * - Manages player state synchronization in multiplayer environment
 * - Processes user input for character control (keyboard/mouse)
 * - Handles different player classes with unique visual appearances
 * - Distinguishes between local player (user-controlled) and remote players
 * 
 * Props:
 * - playerClass: Determines visual appearance and possibly abilities
 * - username: Unique identifier displayed above character
 * - position: Initial spawn coordinates
 * - color: Optional custom color for character
 * - isLocal: Boolean determining if this is the user-controlled player
 * - socketId: Unique network identifier for player synchronization
 * 
 * Technical implementation:
 * - Uses React Three Fiber for 3D rendering within React
 * - Implements Rapier physics for movement and collision
 * - Manages socket.io communication for multiplayer state sync
 * - Handles animation state management for character model
 * 
 * Related files:
 * - GameScene.tsx: Parent component that instantiates players
 * - PlayerUI.tsx: UI overlay for player status information
 * - Server socket handlers: For network state synchronization
 */

import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useAnimations, Html, Sphere } from '@react-three/drei';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { PlayerData, InputState } from '../generated';

// Define animation names for reuse
const ANIMATIONS = {
  IDLE: 'idle',
  WALK_FORWARD: 'walk-forward',
  WALK_BACK: 'walk-back',
  WALK_LEFT: 'walk-left',
  WALK_RIGHT: 'walk-right',
  RUN_FORWARD: 'run-forward',
  RUN_BACK: 'run-back',
  RUN_LEFT: 'run-left',
  RUN_RIGHT: 'run-right',
  JUMP: 'jump',
  ATTACK: 'attack1',
  CAST: 'cast',
  DAMAGE: 'damage',
  DEATH: 'death',
};

// --- Client-side Constants ---
const PLAYER_SPEED = 7.5; // MUST MATCH server PLAYER_SPEED
const SPRINT_MULTIPLIER = 1.8; // Match server logic
const GRAVITY = -6.0;
const JUMP_FORCE = 9.0;

// --- Client-side Prediction Constants ---
const SERVER_TICK_RATE = 60; // Assuming server runs at 60Hz
const SERVER_TICK_DELTA = 1 / SERVER_TICK_RATE; // Use this for prediction
const POSITION_RECONCILE_THRESHOLD = 0.2; // meters
const ROTATION_RECONCILE_THRESHOLD = 0.1; // Radians
const RECONCILE_LERP_FACTOR = 0.15; // Gentler reconciliation to reduce visual snapping

// --- Camera Constants ---
const CAMERA_MODES = {
  FOLLOW: 'follow',  // Default camera following behind player
  ORBITAL: 'orbital' // Orbital camera that rotates around the player
};

const CAMERA_CONFIG = {
  DISTANCE: 5,
  HEIGHT: 2,
  MIN_PITCH: -Math.PI / 4, // Keep for compatibility
  MAX_PITCH: Math.PI / 2,  // Keep for compatibility
  LERP_FACTOR: 1.0,
  SENSITIVITY_YAW: 0.005,   // Side-to-side sensitivity
  SENSITIVITY_PITCH: 0.004, // Up-and-down sensitivity (slightly lower for finer control)
  Y_MIN: -80.0, // Wider pitch range for more natural up/down looking
  Y_MAX: 80.0   // Wider pitch range for more natural up/down looking
};

// --- Movement Constants ---
const MOVEMENT_CONFIG = {
  MAX_SPEED: 0.1,
  ACCELERATION: 0.02,
  DECELERATION: 0.02,
  JUMP_FORCE: 10.0,
  GRAVITY: -9.81,
  GROUND_SNAP: 0.1,
  ROTATION_LERP: 0.1
};

interface PlayerProps {
  playerData: any;
  isLocalPlayer: boolean;
  onRotationChange?: (rotation: THREE.Euler) => void;
  currentInput?: any; // Prop to receive current input for local player
  isDebugArrowVisible?: boolean; // Prop to control debug arrow visibility
  isDebugPanelVisible?: boolean; // Prop to control general debug helpers visibility
}

const PlayerComponent: React.FC<PlayerProps> = ({
  playerData,
  isLocalPlayer,
  onRotationChange,
  currentInput, // Receive input state
  isDebugArrowVisible = false,
  isDebugPanelVisible = false // Destructure with default false
}) => {
  const group = useRef<THREE.Group>(null!);
  const { camera } = useThree();
  const dataRef = useRef<any>(playerData);
  const characterClass = playerData.characterClass || 'Wizard';

  // Model management
  const [modelLoaded, setModelLoaded] = useState(false);
  const [model, setModel] = useState<THREE.Group | null>(null);
  const [mixer, setMixer] = useState<THREE.AnimationMixer | null>(null);
  const [animations, setAnimations] = useState<Record<string, THREE.AnimationAction>>({});
  const [currentAnimation, setCurrentAnimation] = useState<string>(ANIMATIONS.IDLE);

  // --- Client Prediction State ---
  const localPositionRef = useRef<THREE.Vector3>(new THREE.Vector3(playerData.position.x, playerData.position.y, playerData.position.z));
  const localRotationRef = useRef<THREE.Euler>(new THREE.Euler(0, 0, 0, 'YXZ')); // Initialize with zero rotation
  const debugArrowRef = useRef<THREE.ArrowHelper | null>(null); // Declare the ref for the debug arrow

  // Camera control variables
  const isPointerLocked = useRef(false);
  const zoomLevel = useRef(5);
  const targetZoom = useRef(5);

  // Orbital camera variables
  const [cameraMode, setCameraMode] = useState<string>(CAMERA_MODES.FOLLOW);
  const orbitalCameraRef = useRef({
    distance: 8,
    height: 3,
    angle: 0,
    elevation: Math.PI / 6, // Approximately 30 degrees
    autoRotate: false,
    autoRotateSpeed: 0.5,
    lastUpdateTime: Date.now(),
    playerFacingRotation: 0 // Store player's facing direction when entering orbital mode
  });

  // Ref to track if animations have been loaded already to prevent multiple loading attempts
  const animationsLoadedRef = useRef(false);

  // Main character model path
  const mainModelPath = characterClass === 'Paladin'
    ? '/models/paladin/paladin.fbx'
    : '/models/wizard/wizard.fbx';


  // --- State variables ---
  const pointLightRef = useRef<THREE.PointLight>(null!); // Ref for the declarative light

  // Add velocity state
  const velocityRef = useRef<THREE.Vector3>(new THREE.Vector3());

  // Add these new refs after the existing refs
  const currentX = useRef(0);
  const currentY = useRef(0);
  const verticalVelocity = useRef(0);
  const prevJumpRef = useRef(false); // Track previous jump state for rising edge detection
  const jumpAnimationPlayedRef = useRef(false); // Track if jump animation has played for current jump
  const wasGroundedRef = useRef(true); // Track previous grounded state

  // --- Diagnostic Logging Refs ---
  const frameCounter = useRef(0);
  const lastLogTime = useRef(performance.now());
  const reconciliationCount = useRef(0);
  const totalReconciliationError = useRef(0);

  // --- Remote Player Interpolation Buffer ---
  const remotePositionBuffer = useRef<Array<{ pos: THREE.Vector3, timestamp: number }>>([]);
  const remoteTargetPosition = useRef<THREE.Vector3>(new THREE.Vector3());
  const remoteTargetRotation = useRef<number>(0);

  // --- Server Update Diagnostic Refs ---
  const lastServerUpdate = useRef(performance.now());
  const serverUpdateCount = useRef(0);
  const lastServerPos = useRef(new THREE.Vector3(playerData.position.x, playerData.position.y, playerData.position.z));

  // --- Client-Side Movement Calculation ---
  const calculateClientMovement = useCallback((currentPos: THREE.Vector3, currentRot: THREE.Euler, inputState: any, delta: number): THREE.Vector3 => {
    // We need to process movement even if no input if we are in the air (gravity)
    const hasInput = inputState.forward || inputState.backward || inputState.left || inputState.right;

    if (!hasInput && !inputState.jump && currentPos.y <= 0) {
      return currentPos;
    }

    let worldMoveVector = new THREE.Vector3();
    const speed = inputState.sprint ? PLAYER_SPEED * SPRINT_MULTIPLIER : PLAYER_SPEED;

    // Calculate movement direction based on player yaw (not camera)
    const playerYaw = currentRot.y;
    const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), playerYaw);
    const right = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), playerYaw);

    // Add movement based on input
    if (inputState.forward) worldMoveVector.add(forward);
    if (inputState.backward) worldMoveVector.sub(forward);
    if (inputState.left) worldMoveVector.sub(right);
    if (inputState.right) worldMoveVector.add(right);

    // Normalize if moving diagonally
    if (worldMoveVector.lengthSq() > 1.1) {
      worldMoveVector.normalize();
    }

    // Scale by speed and delta time
    worldMoveVector.multiplyScalar(speed * delta);

    // --- Vertical Movement (Jumping/Gravity) ---
    // Apply gravity
    verticalVelocity.current += GRAVITY * delta;

    // Jump impulse (Rising Edge Detection)
    // Only jump if key is pressed, was NOT pressed last frame (or we reset it), and we are on the ground
    if (inputState.jump && !prevJumpRef.current && currentPos.y <= 0.01) {
      verticalVelocity.current = JUMP_FORCE;
    }

    // Update previous jump state
    prevJumpRef.current = inputState.jump;

    // Apply vertical velocity to position
    const newPos = currentPos.clone().add(worldMoveVector);
    newPos.y += verticalVelocity.current * delta;

    // Ground collision
    if (newPos.y < 0) {
      newPos.y = 0;
      verticalVelocity.current = 0;
    }

    return newPos;
  }, []);

  // --- Client-Side Animation Determination ---
  const determineLocalAnimation = useCallback((input: any, isGrounded: boolean): string => {
    if (!input) return ANIMATIONS.IDLE;

    // Priority: Death > Damage > Attack > Cast > Jump > Move > Idle
    // IMPORTANT: Attack and Cast must be checked BEFORE jump to allow casting while airborne

    if (input.attack) return ANIMATIONS.ATTACK;
    if (input.castSpell) return ANIMATIONS.CAST;

    // Jump animation logic: return JUMP while airborne
    // The animation system will handle playing it once via LoopOnce
    if (!isGrounded) {
      return ANIMATIONS.JUMP;
    }

    // Note: input.jump might be true while on ground before takeoff, or while holding space.
    // But if isGrounded is true, we might want to show jump start or just walk if holding space?
    // For now, if grounded and jump pressed, we likely just jumped or are about to.
    // But let's rely on !isGrounded for the main jump loop.
    if (input.jump) return ANIMATIONS.JUMP;

    const { forward, backward, left, right, sprint } = input;
    const isMoving = forward || backward || left || right;

    if (!isMoving) return ANIMATIONS.IDLE;

    let direction = 'forward';

    if (forward && !backward) {
      direction = 'forward';
    } else if (backward && !forward) {
      direction = 'back';
    } else if (left && !right) {
      direction = 'left';
    } else if (right && !left) {
      direction = 'right';
    } else if (forward && left) {
      direction = 'left';
    } else if (forward && right) {
      direction = 'right';
    } else if (backward && left) {
      direction = 'left';
    } else if (backward && right) {
      direction = 'right';
    }

    const moveType = sprint ? 'run' : 'walk';
    return `${moveType}-${direction}`;
  }, []);

  // --- Effect for model loading ---
  useEffect(() => {
    if (!playerData) return; // Guard clause
    const loader = new FBXLoader();

    loader.load(
      mainModelPath,
      (fbx) => {

        // Simplified: Just add the model, setup scale, shadows etc.
        if (characterClass === 'Paladin') {
          fbx.scale.setScalar(1.0);
        } else {
          fbx.scale.setScalar(0.02); // Default/Wizard scale
        }
        fbx.position.set(0, 0, 0);
        // REMOVED TRAVERSE for setting castShadow/receiveShadow to avoid potential errors

        setModel(fbx);

        if (group.current) {
          group.current.add(fbx);
          // Apply position adjustment after adding to group
          fbx.position.y = 0.85; // Raise model to stand on ground (Physics Y=0)

          // --- TRY AGAIN: Traverse to remove embedded lights --- 
          try {
            console.log(`[Player Model Effect ${playerData.username}] Traversing loaded FBX to find embedded lights...`);
            fbx.traverse((child) => {
              if (child && child instanceof THREE.Light) {
                // --- LOGGING ADDED HERE ---
                console.log(`[Player Model Effect ${playerData.username}] --- FOUND AND REMOVING EMBEDDED LIGHT --- Name: ${child.name || 'Unnamed'}, Type: ${child.type}`);
                child.removeFromParent();
              }
            });
          } catch (traverseError) {
            console.error(`[Player Model Effect ${playerData.username}] Error during fbx.traverse for light removal:`, traverseError);
          }
          // --- END TRAVERSE ATTEMPT --- 

        }

        const newMixer = new THREE.AnimationMixer(fbx);
        setMixer(newMixer);
        setModelLoaded(true);

        // Initialize local refs for local player
        if (isLocalPlayer) {
          localPositionRef.current.set(playerData.position.x, playerData.position.y, playerData.position.z);
          localRotationRef.current.set(0, playerData.rotation.y, 0, 'YXZ');
        }
      },
      (progress) => { /* Optional progress log */ },
      (error: any) => {
        console.error(`[Player Model Effect ${playerData.username}] Error loading model ${mainModelPath}:`, error);
      }
    );

    // Cleanup for model loading effect
    return () => {
      if (mixer) mixer.stopAllAction();
      if (model && group.current) group.current.remove(model);
      // Dispose geometry/material if needed
      setModel(null);
      setMixer(null);
      setModelLoaded(false);
      animationsLoadedRef.current = false;
    };
  }, [mainModelPath, characterClass]); // ONLY depend on model path and class

  // New useEffect to load animations when mixer is ready
  useEffect(() => {
    if (mixer && model && !animationsLoadedRef.current) {
      console.log("Mixer and model are ready, loading animations...");
      animationsLoadedRef.current = true;
      loadAnimations(mixer);
    }
  }, [mixer, model, characterClass]);

  // Function to load animations
  const loadAnimations = (mixerInstance: THREE.AnimationMixer) => {
    if (!mixerInstance) {
      console.error("Cannot load animations: mixer is not initialized");
      return;
    }

    console.log(`Loading animations for ${characterClass}...`);

    const animationPaths: Record<string, string> = {};
    const basePath = characterClass === 'Paladin' ? '/models/paladin/' : '/models/wizard/';

    // Map animation keys to file paths, ensuring exact matching of key names
    // Define all animation keys with their exact matching paths
    const animKeys = {
      idle: characterClass === 'Wizard' ? 'wizard-standing-idle.fbx' : 'paladin-idle.fbx',
      'walk-forward': characterClass === 'Wizard' ? 'wizard-standing-walk-forward.fbx' : 'paladin-walk-forward.fbx',
      'walk-back': characterClass === 'Wizard' ? 'wizard-standing-walk-back.fbx' : 'paladin-walk-back.fbx',
      'walk-left': characterClass === 'Wizard' ? 'wizard-standing-walk-left.fbx' : 'paladin-walk-left.fbx',
      'walk-right': characterClass === 'Wizard' ? 'wizard-standing-walk-right.fbx' : 'paladin-walk-right.fbx',
      'run-forward': characterClass === 'Wizard' ? 'wizard-standing-run-forward.fbx' : 'paladin-run-forward.fbx',
      'run-back': characterClass === 'Wizard' ? 'wizard-standing-run-back.fbx' : 'paladin-run-back.fbx',
      'run-left': characterClass === 'Wizard' ? 'wizard-standing-run-left.fbx' : 'paladin-run-left.fbx',
      'run-right': characterClass === 'Wizard' ? 'wizard-standing-run-right.fbx' : 'paladin-run-right.fbx',
      jump: characterClass === 'Wizard' ? 'wizard-standing-jump.fbx' : 'paladin-jump.fbx',
      attack1: characterClass === 'Wizard' ? 'wizard-standing-1h-magic-attack-01.fbx' : 'paladin-attack.fbx',
      cast: characterClass === 'Wizard' ? 'wizard-standing-2h-magic-area-attack-02.fbx' : 'paladin-cast.fbx',
      damage: characterClass === 'Wizard' ? 'wizard-standing-react-small-from-front.fbx' : 'paladin-damage.fbx',
      death: characterClass === 'Wizard' ? 'wizard-standing-react-death-backward.fbx' : 'paladin-death.fbx',
    };

    // Create animation paths
    Object.entries(animKeys).forEach(([key, filename]) => {
      animationPaths[key] = `${basePath}${filename}`;
    });

    console.log('Animation paths:', animationPaths);

    const loader = new FBXLoader();
    const newAnimations: Record<string, THREE.AnimationAction> = {};
    let loadedCount = 0;
    const totalCount = Object.keys(animationPaths).length;

    console.log(`Will load ${totalCount} animations`);

    // Load each animation
    Object.entries(animationPaths).forEach(([name, path]) => {
      console.log(`Loading animation "${name}" from ${path}`);

      // First check if the file exists
      fetch(path)
        .then(response => {
          if (!response.ok) {
            console.error(`Animation file not found: ${path} (${response.status})`);
            loadedCount++;
            checkCompletedLoading();
            return;
          }

          // File exists, proceed with loading
          loadAnimationFile(name, path, mixerInstance);
        })
        .catch(error => {
          console.error(`Network error checking animation file ${path}:`, error);
          loadedCount++;
          checkCompletedLoading();
        });
    });

    // Function to check if all animations are loaded
    const checkCompletedLoading = () => {
      loadedCount++; // Increment here after load attempt (success or fail)
      if (loadedCount === totalCount) {
        const successCount = Object.keys(newAnimations).length;
        if (successCount === totalCount) {
          console.log(`✅ All ${totalCount} animations loaded successfully.`);
        } else {
          console.warn(`⚠️ Loaded ${successCount}/${totalCount} animations. Some might be missing.`);
        }

        // Store all successfully loaded animations in component state
        setAnimations(newAnimations);

        // Debug: log all available animations
        console.log("Available animations: ", Object.keys(newAnimations).join(", "));

        // Play idle animation if available
        if (newAnimations['idle']) {
          // Use setTimeout to ensure state update has propagated and mixer is ready
          setTimeout(() => {
            if (animationsLoadedRef.current) { // Check if still relevant
              console.log('Playing initial idle animation');
              // Use the local newAnimations reference to be sure it's available
              const idleAction = newAnimations['idle'];
              idleAction.reset()
                .setEffectiveTimeScale(1)
                .setEffectiveWeight(1)
                .fadeIn(0.3)
                .play();
              setCurrentAnimation('idle');
            }
          }, 100);
        } else {
          console.error('Idle animation not found among loaded animations! Player might not animate initially.');
        }
      }
    };

    // Function to load an animation file
    const loadAnimationFile = (name: string, path: string, mixerInstance: THREE.AnimationMixer) => {
      if (!mixerInstance) {
        console.error(`Cannot load animation ${name}: mixer is not initialized`);
        // loadedCount is incremented in checkCompletedLoading call below
        checkCompletedLoading();
        return;
      }

      loader.load(
        path,
        (animFbx) => {
          try {
            if (!animFbx.animations || animFbx.animations.length === 0) {
              console.error(`No animations found in ${path}`);
              checkCompletedLoading(); // Call completion even on error
              return;
            }

            const clip = animFbx.animations[0];
            console.log(`Animation "${name}" loaded. Duration: ${clip.duration}s, Tracks: ${clip.tracks.length}`);

            // Try to find hierarchy and parent bone
            let rootBoneName = '';
            animFbx.traverse((obj) => {
              if (obj.type === 'Bone' && !rootBoneName && obj.parent && obj.parent.type === 'Object3D') {
                rootBoneName = obj.name;
                // console.log(`Found potential root bone for anim ${name}: ${rootBoneName}`);
              }
            });

            // Apply name to the clip
            clip.name = name;

            // Retarget the clip if needed
            const retargetedClip = retargetClip(clip, path);

            // Make sure we're in place (remove root motion)
            makeAnimationInPlace(retargetedClip);

            const action = mixerInstance.clipAction(retargetedClip);
            newAnimations[name] = action;

            // Set loop mode based on animation type
            if (
              name === 'idle' ||
              name.startsWith('walk-') ||
              name.startsWith('run-')
            ) {
              action.setLoop(THREE.LoopRepeat, Infinity);
            } else {
              action.setLoop(THREE.LoopOnce, 1);
              action.clampWhenFinished = true;
            }

            console.log(`✅ Animation "${name}" processed and ready.`);
          } catch (e) {
            console.error(`Error processing animation ${name}:`, e);
          }

          checkCompletedLoading(); // Call completion after processing
        },
        (progress) => {
          // Optional: Log animation loading progress for larger files
          // if (progress.total > 1000000) { // Only for large files
          //   console.log(`Loading ${name}: ${Math.round(progress.loaded / progress.total * 100)}%`);
          // }
        },
        (error: any) => {
          console.error(`Error loading animation ${name} from ${path}: ${error.message || 'Unknown error'}`);
          checkCompletedLoading(); // Call completion even on error
        }
      );
    };
  };

  // Improve root motion removal function
  const makeAnimationInPlace = (clip: THREE.AnimationClip) => {
    // console.log(`Making animation "${clip.name}" in-place`);

    // Get all position tracks
    const tracks = clip.tracks;
    const positionTracks = tracks.filter(track => track.name.endsWith('.position'));

    if (positionTracks.length === 0) {
      // console.log(`No position tracks found in "${clip.name}"`);
      return;
    }

    // console.log(`Found ${positionTracks.length} position tracks in "${clip.name}"`);

    // Find the root position track (typically the first bone)
    // Common root bone names: Hips, mixamorigHips, root, Armature
    let rootTrack: THREE.KeyframeTrack | undefined;
    const rootNames = ['Hips.position', 'mixamorigHips.position', 'root.position', 'Armature.position', 'Root.position'];
    rootTrack = positionTracks.find(track => rootNames.some(name => track.name.toLowerCase().includes(name.toLowerCase())));

    if (!rootTrack) {
      // If no common root name found, assume the first position track is the root
      rootTrack = positionTracks[0];
      // console.warn(`Using first position track "${rootTrack.name}" as root for in-place conversion for anim "${clip.name}".`);
    } else {
      // console.log(`Using root bone track "${rootTrack.name}" for in-place conversion for anim "${clip.name}"`);
    }

    const rootTrackNameBase = rootTrack.name.split('.')[0];

    // Filter out root position tracks to remove root motion
    // Keep only the Y component of the root track if needed for jumps, etc.
    const originalLength = clip.tracks.length;
    clip.tracks = tracks.filter(track => {
      if (track.name.startsWith(`${rootTrackNameBase}.position`)) {
        // Maybe keep Y component in the future if needed, for now remove all XYZ root motion.
        return false; // Remove X, Y, Z root position tracks
      }
      return true; // Keep other tracks
    });

    // console.log(`Removed ${originalLength - clip.tracks.length} root motion tracks from "${clip.name}"`);
  };

  // Add a retargetClip function after makeAnimationInPlace
  const retargetClip = (clip: THREE.AnimationClip, sourceModelPath: string) => {
    if (!model) {
      console.warn("Cannot retarget: model not loaded");
      return clip;
    }

    // console.log(`Retargeting animation "${clip.name}" from ${sourceModelPath}`);

    // Get source file basename (without extension)
    const sourceFileName = sourceModelPath.split('/').pop()?.split('.')[0] || '';
    const targetFileName = mainModelPath.split('/').pop()?.split('.')[0] || '';

    if (sourceFileName === targetFileName) {
      // console.log(`Source and target models are the same (${sourceFileName}), no retargeting needed`);
      return clip;
    }

    // console.log(`Retargeting from "${sourceFileName}" to "${targetFileName}"`);

    // Create a new animation clip
    const newTracks: THREE.KeyframeTrack[] = [];

    // Process each track to replace bone names if needed
    clip.tracks.forEach(track => {
      // The track name format is usually "boneName.property"
      const trackNameParts = track.name.split('.');
      if (trackNameParts.length < 2) {
        // console.warn(`Strange track name format: ${track.name}`);
        newTracks.push(track);
        return;
      }

      const boneName = trackNameParts[0];
      const property = trackNameParts.slice(1).join('.');

      // Try to find corresponding bone in target model
      // Check if we need any bone name mappings from source to target
      let targetBoneName = boneName;

      // ** Bone Name Mapping (Example) **
      // If source uses "bip01_" prefix and target uses "mixamorig", map them:
      // if (boneName.startsWith('bip01_')) {
      //   targetBoneName = boneName.replace('bip01_', 'mixamorig');
      // }
      // Add other mappings as needed based on model skeletons

      // Add the fixed track
      const newTrackName = `${targetBoneName}.${property}`;

      // Only create new track if the name needs to change
      if (newTrackName !== track.name) {
        // console.log(`Remapping track: ${track.name} → ${newTrackName}`);

        // Create a new track with same data but new name
        let newTrack: THREE.KeyframeTrack;

        if (track instanceof THREE.QuaternionKeyframeTrack) {
          newTrack = new THREE.QuaternionKeyframeTrack(
            newTrackName,
            Array.from(track.times),
            Array.from(track.values)
          );
        } else if (track instanceof THREE.VectorKeyframeTrack) {
          newTrack = new THREE.VectorKeyframeTrack(
            newTrackName,
            Array.from(track.times),
            Array.from(track.values)
          );
        } else {
          // Fallback for NumberKeyframeTrack or others
          newTrack = new THREE.KeyframeTrack(
            newTrackName,
            Array.from(track.times),
            Array.from(track.values)
          );
        }

        newTracks.push(newTrack);
      } else {
        newTracks.push(track); // No change needed, push original track
      }
    });

    // Create a new animation clip with the fixed tracks
    return new THREE.AnimationClip(
      clip.name,
      clip.duration,
      newTracks,
      clip.blendMode
    );
  };

  // Update playAnimation to have better logging
  const playAnimation = useCallback((name: string, crossfadeDuration = 0.3) => {
    if (!mixer) return; // Ensure mixer exists

    if (!animations[name]) {
      // console.warn(`Animation not found: ${name}`);
      // console.log("Available animations:", Object.keys(animations).join(", "));
      // Fallback to idle if requested animation is missing
      if (name !== ANIMATIONS.IDLE && animations[ANIMATIONS.IDLE]) {
        // console.log(`Falling back to ${ANIMATIONS.IDLE}`);
        name = ANIMATIONS.IDLE;
      } else {
        return; // Cannot play requested or fallback idle
      }
    }

    // console.log(`Playing animation: ${name} (crossfade: ${crossfadeDuration}s)`);

    const targetAction = animations[name];
    const currentAction = animations[currentAnimation];

    if (currentAction && currentAction !== targetAction) {
      // console.log(`Fading out previous animation: ${currentAnimation}`);
      currentAction.fadeOut(crossfadeDuration);
    }

    // console.log(`Starting animation: ${name}`);
    targetAction.reset()
      .setEffectiveTimeScale(1)
      .setEffectiveWeight(1)
      .fadeIn(crossfadeDuration)
      .play();

    setCurrentAnimation(name);
  }, [animations, currentAnimation, mixer]); // Add mixer to dependencies

  // --- NEW Effect: Explicitly set shadow props when model is loaded ---
  useEffect(() => {
    if (model && group.current) {
      console.log(`[Player Shadow Effect ${playerData.username}] Model loaded, traversing group to set shadow props on meshes.`);
      group.current.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          // Explicitly set both cast and receive, although cast is the primary goal here
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
    }
  }, [model]); // Run this effect whenever the model state changes

  // --- Server State Reconciliation --- -> Now handled within useFrame
  // useEffect(() => {
  //   if (!isLocalPlayer || !modelLoaded) return; 

  //   // Update internal ref used by useFrame
  //   dataRef.current = playerData;

  // }, [playerData, isLocalPlayer, modelLoaded]);

  // Set up pointer lock for camera control if local player
  useEffect(() => {
    if (!isLocalPlayer) return;

    const checkServerUpdate = () => {
      const currentServerPos = new THREE.Vector3(playerData.position.x, playerData.position.y, playerData.position.z);
      if (!currentServerPos.equals(lastServerPos.current)) {
        const now = performance.now();
        const timeSinceLastUpdate = now - lastServerUpdate.current;
        serverUpdateCount.current++;

        if (serverUpdateCount.current % 30 === 0) { // Log every 30 updates
          console.log(`[SERVER UPDATES] Received ${serverUpdateCount.current} updates | Last update: ${timeSinceLastUpdate.toFixed(0)}ms ago | Update rate: ${(1000 / timeSinceLastUpdate).toFixed(1)}Hz`);
        }

        lastServerUpdate.current = now;
        lastServerPos.current.copy(currentServerPos);
      }
    };

    checkServerUpdate();

    const handlePointerLockChange = () => {
      isPointerLocked.current = document.pointerLockElement === document.body;
      // Add cursor style changes to match legacy implementation
      if (isPointerLocked.current) {
        document.body.classList.add('cursor-locked');
      } else {
        document.body.classList.remove('cursor-locked');
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isPointerLocked.current || !isLocalPlayer) return;

      if (cameraMode === CAMERA_MODES.FOLLOW) {
        // Update yaw and pitch with separate sensitivities
        localRotationRef.current.y -= e.movementX * CAMERA_CONFIG.SENSITIVITY_YAW;   // Yaw (horizontal)
        localRotationRef.current.x -= e.movementY * CAMERA_CONFIG.SENSITIVITY_PITCH; // Pitch (vertical)

        // Clamp pitch to prevent camera flipping
        const minPitchRad = THREE.MathUtils.degToRad(CAMERA_CONFIG.Y_MIN);
        const maxPitchRad = THREE.MathUtils.degToRad(CAMERA_CONFIG.Y_MAX);
        localRotationRef.current.x = THREE.MathUtils.clamp(localRotationRef.current.x, minPitchRad, maxPitchRad);

        // Normalize yaw to [-PI, PI] for consistency
        localRotationRef.current.y = ((localRotationRef.current.y + Math.PI) % (2 * Math.PI)) - Math.PI;

        // Call the rotation change callback if provided
        if (onRotationChange) {
          onRotationChange(localRotationRef.current);
        }
      } else if (cameraMode === CAMERA_MODES.ORBITAL) {
        // In orbital mode, mouse movement controls the camera angle around the player
        const orbital = orbitalCameraRef.current;
        const sensitivity = CAMERA_CONFIG.SENSITIVITY_YAW; // Use yaw sensitivity for orbital

        // X movement rotates camera around player
        orbital.angle -= e.movementX * sensitivity;

        // Y movement controls camera elevation/height with pitch sensitivity
        orbital.elevation += e.movementY * CAMERA_CONFIG.SENSITIVITY_PITCH;

        // Clamp elevation between reasonable limits (15° to 85°)
        orbital.elevation = Math.max(Math.PI / 12, Math.min(Math.PI / 2.1, orbital.elevation));
      }
    };

    const handleMouseWheel = (e: WheelEvent) => {
      if (!isLocalPlayer) return;

      if (cameraMode === CAMERA_MODES.FOLLOW) {
        // Follow camera zoom
        const zoomSpeed = 0.8; // Match legacy zoom speed
        const zoomChange = Math.sign(e.deltaY) * zoomSpeed;
        const minZoom = 2.0; // Closest zoom
        const maxZoom = 12.0; // Furthest zoom allowed
        targetZoom.current = Math.max(minZoom, Math.min(maxZoom, zoomLevel.current + zoomChange));
      } else if (cameraMode === CAMERA_MODES.ORBITAL) {
        // Orbital camera zoom
        const orbital = orbitalCameraRef.current;
        const zoomSpeed = 0.5;
        const zoomChange = Math.sign(e.deltaY) * zoomSpeed;

        // Adjust orbital distance
        orbital.distance = Math.max(3, Math.min(20, orbital.distance + zoomChange));
      }
    };

    // Request pointer lock on click
    const handleCanvasClick = () => {
      if (!isPointerLocked.current) {
        document.body.requestPointerLock();
      }
    };

    document.addEventListener('pointerlockchange', handlePointerLockChange);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('wheel', handleMouseWheel);
    document.addEventListener('click', handleCanvasClick);

    return () => {
      document.removeEventListener('pointerlockchange', handlePointerLockChange);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('wheel', handleMouseWheel);
      document.removeEventListener('click', handleCanvasClick);
    };
  }, [isLocalPlayer, onRotationChange, cameraMode]);

  // Handle one-time animation completion
  useEffect(() => {
    // Explicitly wrap hook body
    {
      if (
        mixer &&
        animations[currentAnimation] &&
        (currentAnimation === ANIMATIONS.JUMP ||
          currentAnimation === ANIMATIONS.ATTACK ||
          currentAnimation === ANIMATIONS.CAST)
      ) {
        const action = animations[currentAnimation];

        // Ensure action exists and has a clip
        if (!action || !action.getClip()) return;

        const duration = action.getClip().duration;

        // Define the listener function
        const onFinished = (event: any) => {
          // Only act if the finished action is the one we are tracking
          if (event.action === action) {
            // console.log(`Animation finished: ${currentAnimation}. Playing idle.`);
            playAnimation(ANIMATIONS.IDLE, 0.1); // Faster transition back to idle
            mixer.removeEventListener('finished', onFinished); // Remove listener
          }
        };

        // Add the listener
        mixer.addEventListener('finished', onFinished);

        // Cleanup function to remove listener if component unmounts or animation changes
        return () => {
          if (mixer) {
            mixer.removeEventListener('finished', onFinished);
          }
        };
      }
    }
  }, [currentAnimation, animations, mixer, playAnimation]); // Ensure all dependencies are listed

  // --- Handle Camera Toggle ---
  const toggleCameraMode = useCallback(() => {
    const newMode = cameraMode === CAMERA_MODES.FOLLOW ? CAMERA_MODES.ORBITAL : CAMERA_MODES.FOLLOW;
    setCameraMode(newMode);

    // Store player's facing direction when entering orbital mode
    if (newMode === CAMERA_MODES.ORBITAL) {
      // Use the current reconciled rotation from the ref
      orbitalCameraRef.current.playerFacingRotation = localRotationRef.current.y;
      console.log(`[Orbital Toggle] Storing playerFacingRotation: ${orbitalCameraRef.current.playerFacingRotation.toFixed(3)}`); // DEBUG
      // Set the initial orbital angle to match the player's facing direction
      orbitalCameraRef.current.angle = localRotationRef.current.y;
      // Reset elevation to a default value for a consistent starting view
      orbitalCameraRef.current.elevation = Math.PI / 6;

      // Log the stored rotation for debugging
      console.log(`Entering orbital mode. Stored player rotation: ${(localRotationRef.current.y * (180 / Math.PI)).toFixed(2)}°`);
    }

    console.log(`Camera mode toggled to: ${newMode}`);
  }, [cameraMode]); // localRotationRef is not a state/prop, so not needed here

  // Set up keyboard handlers for camera toggling
  useEffect(() => {
    if (!isLocalPlayer) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      // Toggle camera mode on 'C' key press
      if (event.code === 'KeyC' && !event.repeat) { // Check for !event.repeat
        toggleCameraMode();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isLocalPlayer, toggleCameraMode]);

  // Update camera position in useFrame
  useFrame((state, delta) => {
    const dt = Math.min(delta, 1 / 30); // clamp to avoid huge jumps from tab-swap

    // Update animation mixer
    if (mixer) {
      mixer.update(dt);
    }

    if (!group.current || !modelLoaded) return;

    // LOCAL player prediction
    if (isLocalPlayer && currentInput) {
      // Use FIXED delta matching server (1/60s) for prediction accuracy
      // This eliminates prediction drift caused by variable frame times
      const FIXED_DELTA = 1 / 60;

      // Calculate predicted position based on current input using FIXED DELTA
      const predictedPosition = calculateClientMovement(
        localPositionRef.current,
        localRotationRef.current,
        currentInput,
        FIXED_DELTA // ← Fixed delta matching server (not frame delta)
      );
      localPositionRef.current.copy(predictedPosition);

      // RECONCILIATION: adaptive lerp based on error magnitude
      const serverPos = new THREE.Vector3(playerData.position.x, playerData.position.y, playerData.position.z);
      const distError = localPositionRef.current.distanceTo(serverPos);

      // --- DIAGNOSTIC LOGGING ---
      frameCounter.current++;
      const now = performance.now();
      if (now - lastLogTime.current > 1000) { // Log every second
        const fps = frameCounter.current;
        const avgReconciliationError = reconciliationCount.current > 0
          ? (totalReconciliationError.current / reconciliationCount.current).toFixed(3)
          : '0.000';

        console.log(`[MOVEMENT DIAGNOSTICS] FPS: ${fps} | Reconciliations: ${reconciliationCount.current} | Avg Error: ${avgReconciliationError}m | Current Error: ${distError.toFixed(3)}m | Frame Delta: ${(dt * 1000).toFixed(1)}ms`);

        // Reset counters
        frameCounter.current = 0;
        reconciliationCount.current = 0;
        totalReconciliationError.current = 0;
        lastLogTime.current = now;
      }

      // Track reconciliation stats
      if (distError > 0.01) {
        reconciliationCount.current++;
        totalReconciliationError.current += distError;
      }

      if (distError > 1.0) {
        // Huge error (> 1 meter): snap immediately (likely teleport or major desync)
        console.warn(`[RECONCILIATION] SNAP! Error: ${distError.toFixed(3)}m - Teleporting to server position`);
        localPositionRef.current.copy(serverPos);
      } else if (distError > POSITION_RECONCILE_THRESHOLD) {
        // Large error: aggressive correction with adaptive speed
        // Faster correction for larger errors (0.15 to 0.3 lerp factor)
        const lerpFactor = Math.min(0.3, 0.15 + distError * 0.3);
        if (distError > 0.5) {
          console.warn(`[RECONCILIATION] Large error: ${distError.toFixed(3)}m - Lerp factor: ${lerpFactor.toFixed(3)}`);
        }
        localPositionRef.current.lerp(serverPos, lerpFactor);
      } else {
        // Small error: gentle smoothing to avoid visible pop
        localPositionRef.current.lerp(serverPos, 0.05);
      }

      // Apply position and rotation to the model group
      group.current.position.copy(localPositionRef.current);
      group.current.rotation.y = localRotationRef.current.y + Math.PI; // Add 180-degree offset

      // --- Client-Side Animation Prediction ---
      const isGrounded = localPositionRef.current.y <= 0.01;
      const predictedAnim = determineLocalAnimation(currentInput, isGrounded);

      // Only play animation if it's different from current
      // This prevents jump (LoopOnce) from restarting every frame
      if (predictedAnim !== currentAnimation) {
        playAnimation(predictedAnim, 0.2);
      }
    } else {
      // REMOTE player interpolation with buffering (eliminates jitter)
      const serverPosition = new THREE.Vector3(playerData.position.x, playerData.position.y, playerData.position.z);
      const now = performance.now();

      // Add new server snapshot to buffer if position changed
      if (remotePositionBuffer.current.length === 0 ||
        serverPosition.distanceTo(remotePositionBuffer.current[remotePositionBuffer.current.length - 1].pos) > 0.001) {
        remotePositionBuffer.current.push({
          pos: serverPosition.clone(),
          timestamp: now
        });

        // Keep buffer size reasonable (last 10 snapshots = ~500ms of history)
        if (remotePositionBuffer.current.length > 10) {
          remotePositionBuffer.current.shift();
        }
      }

      // Interpolate between buffered positions (render 100ms in the past for smoothness)
      const renderTime = now - 100;

      if (remotePositionBuffer.current.length >= 2) {
        // Find the two snapshots to interpolate between
        let i = 0;
        while (i < remotePositionBuffer.current.length - 1 &&
          remotePositionBuffer.current[i + 1].timestamp <= renderTime) {
          i++;
        }

        if (i < remotePositionBuffer.current.length - 1) {
          const snap0 = remotePositionBuffer.current[i];
          const snap1 = remotePositionBuffer.current[i + 1];
          const t = (renderTime - snap0.timestamp) / (snap1.timestamp - snap0.timestamp);

          // Interpolate between the two snapshots
          remoteTargetPosition.current.lerpVectors(snap0.pos, snap1.pos, Math.min(1, Math.max(0, t)));
        } else {
          // Use most recent snapshot if we're ahead of buffer
          remoteTargetPosition.current.copy(remotePositionBuffer.current[remotePositionBuffer.current.length - 1].pos);
        }
      } else if (remotePositionBuffer.current.length === 1) {
        // Only one snapshot, use it directly
        remoteTargetPosition.current.copy(remotePositionBuffer.current[0].pos);
      } else {
        // No buffer yet, use server position directly
        remoteTargetPosition.current.copy(serverPosition);
      }

      // Smooth movement to interpolated target position
      group.current.position.lerp(remoteTargetPosition.current, Math.min(1, dt * 15));

      // Rotation from server (smooth)
      const targetRotation = new THREE.Euler(0, playerData.rotation.y, 0, 'YXZ');
      group.current.quaternion.slerp(new THREE.Quaternion().setFromEuler(targetRotation), Math.min(1, dt * 10));
    }

    // Update camera based on mode with proper third-person positioning
    if (isLocalPlayer) {
      if (cameraMode === CAMERA_MODES.FOLLOW) {
        const playerPosition = group.current.position;
        const playerRotation = localRotationRef.current;

        // Calculate camera position (behind player)
        const offset = new THREE.Vector3(0, CAMERA_CONFIG.HEIGHT, CAMERA_CONFIG.DISTANCE);

        // Create rotation matrix for both yaw and pitch
        const rotationMatrix = new THREE.Matrix4();
        rotationMatrix.makeRotationFromEuler(new THREE.Euler(
          playerRotation.x, // Pitch
          playerRotation.y, // Yaw
          0,               // No roll
          'YXZ'           // Rotation order: yaw first, then pitch
        ));

        // Apply rotation to offset
        offset.applyMatrix4(rotationMatrix);

        // Set camera position (add offset for third-person view)
        const targetPosition = playerPosition.clone().add(offset);
        camera.position.copy(targetPosition);

        // Set camera rotation to look at player
        camera.rotation.set(playerRotation.x, playerRotation.y, 0, 'YXZ');
      } else {
        // Orbital camera mode
        const orbital = orbitalCameraRef.current;

        // Calculate orbital camera position
        const horizontalDistance = orbital.distance * Math.cos(orbital.elevation);
        const height = orbital.distance * Math.sin(orbital.elevation);

        const orbitX = group.current.position.x + Math.sin(orbital.angle) * horizontalDistance;
        const orbitY = group.current.position.y + height;
        const orbitZ = group.current.position.z + Math.cos(orbital.angle) * horizontalDistance;

        // Set camera position directly
        camera.position.set(orbitX, orbitY, orbitZ);

        // Look at player with offset for height
        const lookTarget = group.current.position.clone().add(new THREE.Vector3(0, 1.5, 0));
        camera.lookAt(lookTarget);
      }
    }
  });

  // --- Animation Triggering based on Server State ---
  useEffect(() => {
    // Explicitly wrap hook body
    {
      // Only update animations if mixer and animations exist
      if (!mixer || Object.keys(animations).length === 0) {
        return;
      }

      const serverAnim = playerData.currentAnimation;

      // console.log(`[Anim Check] Received ServerAnim: ${serverAnim}, Current LocalAnim: ${currentAnimation}, Is Available: ${!!animations[serverAnim]}`);

      // Play animation if it's different and available
      // For local player, ONLY play non-movement animations from server (like damage, death)
      // or if we are NOT predicting movement. 
      // Actually, for simplicity, if it's local player, we largely ignore server for movement animations
      // because we predict them. But we should respect state changes we might not predict (like stun/death).

      const isMovementAnim = serverAnim.startsWith('walk') || serverAnim.startsWith('run') || serverAnim === 'idle' || serverAnim === 'jump';
      const shouldIgnoreServer = isLocalPlayer && isMovementAnim;

      if (!shouldIgnoreServer && serverAnim && serverAnim !== currentAnimation && animations[serverAnim]) {
        // console.log(`[Anim Play] Server requested animation change to: ${serverAnim}`);
        try {
          playAnimation(serverAnim, 0.2);
        } catch (error) {
          console.error(`[Anim Error] Error playing animation ${serverAnim}:`, error);
          // Attempt to fallback to idle if error occurs and not already idle
          if (animations['idle'] && currentAnimation !== 'idle') {
            playAnimation('idle', 0.2);
          }
        }
      } else if (serverAnim && !animations[serverAnim]) {
        // Log if server requests an animation we don't have loaded
        // console.warn(`[Anim Warn] Server requested unavailable animation: ${serverAnim}. Available: ${Object.keys(animations).join(', ')}`);
      }
    }
  }, [playerData.currentAnimation, animations, mixer, playAnimation, currentAnimation]); // Dependencies include things that trigger animation changes

  return (
    <group ref={group} castShadow>
      {/* Declarative PointLight */}
      <pointLight
        ref={pointLightRef}
        position={[0, -0.5, 0]} // Lowered position further
        color={0xffccaa}
        intensity={2.5} // Increased intensity
        distance={5}
        decay={2}
        castShadow={false}
      />

      {/* Debug Marker Sphere */}
      <Sphere
        args={[0.1, 16, 16]}
        position={[0, -0.5, 0]} // Match the new light position
        visible={isDebugPanelVisible}
      >
        <meshBasicMaterial color="red" wireframe />
      </Sphere>

      {/* Model added dynamically */}
      {/* Name tag */}
      {model && (
        <Html position={[0, 2.5, 0]} center distanceFactor={10}>
          <div className="nametag">
            <div className="nametag-text">{playerData.username}</div>
            <div className="nametag-class">{characterClass}</div>
          </div>
        </Html>
      )}
    </group>
  );
};

// Export memoized version to prevent unnecessary re-renders
export const Player = React.memo(PlayerComponent, (prevProps, nextProps) => {
  // Only re-render if player data actually changed
  const prevData = prevProps.playerData;
  const nextData = nextProps.playerData;

  // For local player, always re-render (needs to respond to input immediately)
  if (nextProps.isLocalPlayer) {
    return false; // Always re-render local player
  }

  // For remote players, only re-render if position, rotation, or animation changed
  return (
    prevData.position.x === nextData.position.x &&
    prevData.position.y === nextData.position.y &&
    prevData.position.z === nextData.position.z &&
    prevData.rotation.y === nextData.rotation.y &&
    prevData.currentAnimation === nextData.currentAnimation &&
    prevProps.isDebugPanelVisible === nextProps.isDebugPanelVisible
  );
});