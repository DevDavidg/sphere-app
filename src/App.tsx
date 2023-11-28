import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import * as CANNON from 'cannon';

const App = () => {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (containerRef.current === null) return;

    const scene = new THREE.Scene();
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);

    const camera = new THREE.PerspectiveCamera(
      120,
      window.innerWidth / window.innerHeight,
      0.1,
      100
    );
    camera.position.z = 5;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    containerRef.current.appendChild(renderer.domElement);

    const world = new CANNON.World();

    const glassMaterial = new THREE.MeshPhongMaterial({
      color: 0xffffff,
      shininess: 1000,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
    });

    const mainSphereRadius = 2;
    const mainSphereGeometry = new THREE.SphereGeometry(
      mainSphereRadius,
      128,
      128
    );
    mainSphereGeometry.scale(1.5, 1.5, -1.5);
    const mainSphereMesh = new THREE.Mesh(mainSphereGeometry, glassMaterial);
    scene.add(mainSphereMesh);

    const cannonMaterial = new CANNON.Material('transparentMaterial');
    cannonMaterial.restitution = 0;

    const RandomColorSphere = () => {
      const color = Math.floor(Math.random() * 16777215).toString(16);
      return color;
    };

    const smallSphereMaterial = new THREE.MeshPhongMaterial({
      color: `#${RandomColorSphere()}`,
      shininess: 4000,
      clipShadows: true,
      envMap: new THREE.CubeTextureLoader().load([
        'https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/cube/Bridge2/posx.jpg',
        'https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/cube/Bridge2/negx.jpg',
        'https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/cube/Bridge2/posy.jpg',
        'https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/cube/Bridge2/negy.jpg',
        'https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/cube/Bridge2/posz.jpg',
        'https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/cube/Bridge2/negz.jpg',
      ]),
      reflectivity: 0.2,
    });
    const smallSphereGeometry = new THREE.SphereGeometry(0.5, 32, 32);
    const smallSphereMeshes = [] as THREE.Mesh[];
    const smallSphereBodies = [] as CANNON.Body[];
    const generateSpheres = (radius: number, height: number) => {
      const sphereShape = new CANNON.Sphere(radius);
      const sphereBody = new CANNON.Body({
        mass: 1,
        material: cannonMaterial,
        position: new CANNON.Vec3(0, height, 0),
      });
      sphereBody.addShape(sphereShape);
      world.addBody(sphereBody);

      const sphereMesh = new THREE.Mesh(
        smallSphereGeometry,
        smallSphereMaterial
      );
      sphereMesh.position.set(0, height, 0);
      scene.add(sphereMesh);

      smallSphereMeshes.push(sphereMesh);
      smallSphereBodies.push(sphereBody);
    };

    const sphereCount = 10;

    for (let i = 0; i < sphereCount; i++) {
      generateSpheres(0.5, i * 2);
    }

    const generateRandomPositions = (radius: number) => {
      const randomX = Math.random() * (radius - -radius) + -radius;
      const randomY = Math.random() * (radius - -radius) + -radius;
      const randomZ = Math.random() * (radius - -radius) + -radius;
      return [randomX, randomY, randomZ];
    };

    const positions = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
      generateRandomPositions(1),
      generateRandomPositions(2),
      generateRandomPositions(3),
      generateRandomPositions(2),
    ];

    positions.forEach((position, index) => {
      const smallSphereMesh = new THREE.Mesh(
        smallSphereGeometry,
        smallSphereMaterial
      );
      smallSphereMesh.position.set(position[0], position[1], position[2]);
      scene.add(smallSphereMesh);
      smallSphereMeshes.push(smallSphereMesh);

      if (index === 1 || index === 3 || index === 5 || index === 7) {
        const light = new THREE.PointLight(0xffffff, 3, 10);
        light.position.set(position[0], position[1], position[2]);
        scene.add(light);
      }

      const smallSphereShape = new CANNON.Sphere(0.5);
      const smallSphereBody = new CANNON.Body({
        mass: 1,
        material: cannonMaterial,
        position: new CANNON.Vec3(...position),
      });
      smallSphereBody.addShape(smallSphereShape);
      world.addBody(smallSphereBody);
      smallSphereBodies.push(smallSphereBody);
    });

    const controls = new OrbitControls(camera, renderer.domElement);

    controls.rotateSpeed = 0.5;
    controls.enableDamping = true;
    controls.dampingFactor = 0.025;

    const animate = () => {
      requestAnimationFrame(animate);
      world.step(1 / 60);

      const gravityDirection = new THREE.Vector3(0, -2, 0);
      gravityDirection.applyQuaternion(camera.quaternion);
      world.gravity.set(
        gravityDirection.x,
        gravityDirection.y,
        gravityDirection.z
      );

      smallSphereBodies.forEach((body, index) => {
        const distanceFromCenter = body.position.distanceTo(
          new CANNON.Vec3(0, -0.4, 0)
        );
        if (distanceFromCenter > mainSphereRadius) {
          body.velocity.scale(0.5, body.velocity);
          body.position.scale(
            mainSphereRadius / distanceFromCenter,
            body.position
          );
          body.material.restitution = 1.5;
        }

        smallSphereMeshes[index].position.set(
          body.position.x,
          body.position.y,
          body.position.z
        );
      });

      controls.update();
      renderer.render(scene, camera);
    };

    const onResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };

    window.addEventListener('resize', onResize);
    animate();

    return () => {
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100vh', position: 'absolute' }}
    ></div>
  );
};

export default App;
