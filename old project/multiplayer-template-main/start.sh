const Skybox: React.FC = () => {
  const gltf = useGLTF('/models/skybox/skybox.glb');
  React.useEffect(() => {
    gltf.scene.traverse((child: any) => {
      if (child.isMesh && child.material) {
        child.material.side = THREE.DoubleSide;
      }
    });
  }, [gltf]);
  return (
    <primitive 
      object={gltf.scene} 
      scale={[50, 50, 50]}
      position={[0, 0, 0]}
    />
  );
}; 