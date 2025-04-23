import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import * as CANNON from "cannon-es";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass";
import { FXAAShader } from "three/examples/jsm/shaders/FXAAShader";

interface PhysicsConfig {
  gravity: number;
  friction: number;
  restitution: number;
  dampingFactor: number;
  solverIterations: number;
  timeStep: number;
  boundaryForceMultiplier: number;
  centralGravityStrength: number;
  exitThreshold: number;
}

interface SphereConfig {
  mainRadius: number;
  smallCount: number;
  smallMinRadius: number;
  smallMaxRadius: number;
  cueBallRadius: number;
  cueBallMass: number;
  cueBallImpulseFactor: number;
  cueBallColor: THREE.Color;
  cueBallEmissiveIntensity: number;
  regenerationInterval: number;
  popupDuration: number;
  popupScale: number;
  newSphereImpulseFactor: number;
}

interface SphereUserData {
  hasLight: boolean;
  lightIndex: number;
  isCueBall?: boolean;
}

const GalacticSpheres: React.FC = () => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isActive, setIsActive] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const worldRef = useRef<CANNON.World | null>(null);
  const timeRef = useRef<number>(0);
  const mousePosition = useRef<THREE.Vector2>(new THREE.Vector2(0, 0));
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);

  const smallSphereMeshesRef = useRef<THREE.Mesh[]>([]);
  const smallSphereBodiesRef = useRef<CANNON.Body[]>([]);
  const mainSphereMeshRef = useRef<THREE.Mesh | null>(null);
  const cueBallIndexRef = useRef<number>(-1);

  const lastImpulseTimeRef = useRef<number>(0);
  const impulseIntervalRef = useRef<number>(3000);
  const lastSphereRegenerationTimeRef = useRef<number>(0);
  const impulseDirectionRef = useRef<THREE.Vector3>(new THREE.Vector3(0, 0, 0));
  const newSphereScaleRef = useRef<number>(0);
  const pendingNewSphereRef = useRef<{
    mesh: THREE.Mesh | null;
    body: CANNON.Body | null;
    startTime: number;
    initialPosition: THREE.Vector3;
  }>({
    mesh: null,
    body: null,
    startTime: 0,
    initialPosition: new THREE.Vector3(),
  });

  const physicsConfig: PhysicsConfig = {
    gravity: -5.0,
    friction: 0.1,
    restitution: 0.85,
    dampingFactor: 0.08,
    solverIterations: 20,
    timeStep: 1 / 60,
    boundaryForceMultiplier: 150,
    centralGravityStrength: 0,
    exitThreshold: 1.02,
  };

  const sphereConfig: SphereConfig = {
    mainRadius: 5.0,
    smallCount: 14,
    smallMinRadius: 0.2,
    smallMaxRadius: 0.6,
    cueBallRadius: 0.5,
    cueBallMass: 5.0,
    cueBallImpulseFactor: 40.0,
    cueBallColor: new THREE.Color(0xffffff),
    cueBallEmissiveIntensity: 0.9,
    regenerationInterval: 10000,
    popupDuration: 800,
    popupScale: 1.5,
    newSphereImpulseFactor: 40.0,
  };

  useEffect(() => {
    const container = containerRef.current;

    if (container) {
      while (container.firstChild) {
        container.removeChild(container.firstChild);
      }
    }

    if (container === null) return;

    const scene = new THREE.Scene();
    sceneRef.current = scene;
    scene.background = new THREE.Color(0x030820);
    scene.fog = new THREE.FogExp2(0x050a30, 0.025);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
    directionalLight.position.set(5, 10, 7);
    directionalLight.castShadow = true;
    scene.add(directionalLight);

    const innerLight = new THREE.PointLight(0xffffff, 4.0, 10);
    innerLight.position.set(0, 0, 0);
    scene.add(innerLight);

    const camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      100
    );
    camera.position.set(0, 10, 0);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    rendererRef.current = renderer;

    if (containerRef.current) {
      containerRef.current.appendChild(renderer.domElement);
    }

    const renderScene = new RenderPass(scene, camera);
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.7,
      0.4,
      0.85
    );
    const fxaaPass = new ShaderPass(FXAAShader);
    fxaaPass.material.uniforms["resolution"].value.x =
      1 / (window.innerWidth * renderer.getPixelRatio());
    fxaaPass.material.uniforms["resolution"].value.y =
      1 / (window.innerHeight * renderer.getPixelRatio());

    const composer = new EffectComposer(renderer);
    composer.addPass(renderScene);
    composer.addPass(bloomPass);
    composer.addPass(fxaaPass);

    const world = new CANNON.World();
    worldRef.current = world;

    world.gravity.set(0, 0, 0);
    world.broadphase = new CANNON.SAPBroadphase(world);
    world.allowSleep = false;

    world.defaultContactMaterial.friction = physicsConfig.friction;
    world.defaultContactMaterial.restitution = physicsConfig.restitution;

    const glassMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      metalness: 0.1,
      roughness: 0.05,
      transmission: 0.98,
      thickness: 0.5,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      clearcoat: 1.0,
      clearcoatRoughness: 0.05,
      ior: 1.6,
    });

    const mainSphereRadius = sphereConfig.mainRadius;
    const mainSphereGeometry = new THREE.SphereGeometry(
      mainSphereRadius,
      64,
      64
    );
    const mainSphereMesh = new THREE.Mesh(mainSphereGeometry, glassMaterial);
    mainSphereMesh.castShadow = true;
    mainSphereMesh.receiveShadow = true;
    mainSphereMesh.position.set(0, 0, 0);
    scene.add(mainSphereMesh);
    mainSphereMeshRef.current = mainSphereMesh;

    const particlesGeometry = new THREE.BufferGeometry();
    const particlesCount = 300;
    const posArray = new Float32Array(particlesCount * 3);

    for (let i = 0; i < particlesCount * 3; i += 3) {
      const phi = Math.random() * Math.PI * 2;
      const theta = Math.random() * Math.PI;
      const r = 7 + Math.random() * 8;

      posArray[i] = r * Math.sin(theta) * Math.cos(phi);
      posArray[i + 1] = r * Math.sin(theta) * Math.sin(phi);
      posArray[i + 2] = r * Math.cos(theta);
    }

    particlesGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(posArray, 3)
    );

    const particlesMaterial = new THREE.PointsMaterial({
      size: 0.1,
      color: 0xffffff,
      transparent: true,
      opacity: 0.7,
      sizeAttenuation: true,
      blending: THREE.AdditiveBlending,
    });

    const particlesMesh = new THREE.Points(
      particlesGeometry,
      particlesMaterial
    );
    scene.add(particlesMesh);

    const cannonMaterial = new CANNON.Material("sphereMaterial");
    cannonMaterial.restitution = physicsConfig.restitution;
    cannonMaterial.friction = physicsConfig.friction;

    const generateVibrantColor = () => {
      const hue = Math.random();
      const saturation = 0.7 + Math.random() * 0.3;
      const lightness = 0.5 + Math.random() * 0.3;
      return new THREE.Color().setHSL(hue, saturation, lightness);
    };

    const sphereCount = sphereConfig.smallCount;
    const smallSphereMeshes: THREE.Mesh[] = [];
    const smallSphereBodies: CANNON.Body[] = [];

    cueBallIndexRef.current = Math.floor(Math.random() * sphereCount);

    const lastVelocities = new Array(sphereCount)
      .fill(null)
      .map(() => new CANNON.Vec3(0, 0, 0));
    const stationaryTimes = new Array(sphereCount).fill(0);

    for (let i = 0; i < sphereCount; i++) {
      const isCueBall = i === cueBallIndexRef.current;

      const radius = isCueBall
        ? sphereConfig.cueBallRadius
        : sphereConfig.smallMinRadius +
          Math.random() *
            (sphereConfig.smallMaxRadius - sphereConfig.smallMinRadius);

      const sphereColor = isCueBall
        ? sphereConfig.cueBallColor
        : generateVibrantColor();

      const sphereMaterial = new THREE.MeshPhysicalMaterial({
        color: sphereColor,
        metalness: isCueBall ? 0.8 : Math.random() * 0.3 + 0.5,
        roughness: isCueBall ? 0.1 : Math.random() * 0.2 + 0.1,
        emissive: sphereColor.clone().multiplyScalar(0.5),
        emissiveIntensity: isCueBall
          ? sphereConfig.cueBallEmissiveIntensity
          : Math.random() * 0.6 + 0.4,
        clearcoat: isCueBall ? 1.0 : 0.8,
        clearcoatRoughness: isCueBall ? 0.1 : 0.2,
      });

      const sphereGeometry = new THREE.SphereGeometry(radius, 24, 24);
      const sphereMesh = new THREE.Mesh(sphereGeometry, sphereMaterial);
      sphereMesh.castShadow = true;
      sphereMesh.receiveShadow = true;

      const maxStartRadius = mainSphereRadius * 0;
      const randomDir = new THREE.Vector3(
        Math.random() * 2 - 1,
        Math.random() * 2 - 1,
        Math.random() * 2 - 1
      ).normalize();
      const randomDist = Math.random() * maxStartRadius;
      const x = randomDir.x * randomDist;
      const y = randomDir.y * randomDist;
      const z = randomDir.z * randomDist;
      sphereMesh.position.set(x, y, z);
      scene.add(sphereMesh);
      smallSphereMeshes.push(sphereMesh);

      if (isCueBall || Math.random() > 0.3) {
        const pointLight = new THREE.PointLight(
          sphereColor.getHex(),
          isCueBall ? 3.0 : Math.random() * 1.5 + 0.5,
          isCueBall ? 5 : 3
        );
        pointLight.position.copy(sphereMesh.position);
        scene.add(pointLight);

        const lightIndex = scene.children.indexOf(pointLight);

        sphereMesh.userData = {
          hasLight: true,
          lightIndex,
          isCueBall,
        } as SphereUserData;
      } else {
        sphereMesh.userData = {
          hasLight: false,
          lightIndex: -1,
          isCueBall,
        } as SphereUserData;
      }

      const sphereShape = new CANNON.Sphere(radius);
      const sphereBody = new CANNON.Body({
        mass: isCueBall ? sphereConfig.cueBallMass : radius * 2,
        material: cannonMaterial,
        position: new CANNON.Vec3(x, y, z),
        linearDamping: physicsConfig.dampingFactor,
        angularDamping: physicsConfig.dampingFactor,
      });
      sphereBody.addShape(sphereShape);

      const initialVelocity = new CANNON.Vec3(
        (Math.random() - 0.5) * 1.5,
        (Math.random() - 0.5) * 1.5,
        (Math.random() - 0.5) * 1.5
      );
      sphereBody.velocity.copy(initialVelocity);

      world.addBody(sphereBody);
      smallSphereBodies.push(sphereBody);

      if (isCueBall) {
        calculateNewImpulseDirection();
      }
    }

    function calculateNewImpulseDirection(): THREE.Vector3 {
      let x, y, z, lengthSquared;
      do {
        x = Math.random() * 2 - 1;
        y = Math.random() * 2 - 1;
        z = Math.random() * 2 - 1;
        lengthSquared = x * x + y * y + z * z;
      } while (lengthSquared >= 1 || lengthSquared < 0.1);

      const length = Math.sqrt(lengthSquared);
      return new THREE.Vector3(x / length, y / length, z / length);
    }

    function applyCueBallImpulse(time: number) {
      if (time - lastImpulseTimeRef.current > impulseIntervalRef.current) {
        const cueBallIndex = cueBallIndexRef.current;
        const sphereBodies = smallSphereBodiesRef.current;

        if (cueBallIndex >= 0 && cueBallIndex < sphereBodies.length) {
          const cueBallBody = sphereBodies[cueBallIndex];

          const direction = calculateNewImpulseDirection();
          impulseDirectionRef.current.copy(direction);

          const impulseVector = new CANNON.Vec3(
            direction.x * sphereConfig.cueBallImpulseFactor,
            direction.y * sphereConfig.cueBallImpulseFactor,
            direction.z * sphereConfig.cueBallImpulseFactor
          );

          const applicationOffset = new CANNON.Vec3(
            (Math.random() - 0.5) * 0.1,
            (Math.random() - 0.5) * 0.1,
            (Math.random() - 0.5) * 0.1
          );
          cueBallBody.applyImpulse(impulseVector, applicationOffset);

          lastImpulseTimeRef.current = time;
          impulseIntervalRef.current = 3000 + Math.random() * 2000;
        }
      }
    }

    function removeRandomSphere(time: number) {
      const sphereMeshes = smallSphereMeshesRef.current;
      const sphereBodies = smallSphereBodiesRef.current;
      const cueBallIndex = cueBallIndexRef.current;

      if (sphereMeshes.length <= 1 || sphereBodies.length <= 1) return;

      let randomIndex;
      do {
        randomIndex = Math.floor(Math.random() * sphereMeshes.length);
      } while (randomIndex === cueBallIndex);

      const meshToRemove = sphereMeshes[randomIndex];
      const bodyToRemove = sphereBodies[randomIndex];

      if (randomIndex < cueBallIndex) {
        cueBallIndexRef.current--;
      }

      const userData = meshToRemove.userData as SphereUserData;
      if (userData.hasLight && userData.lightIndex >= 0) {
        const lightToRemove = scene.children[
          userData.lightIndex
        ] as THREE.Light;
        if (lightToRemove) {
          scene.remove(lightToRemove);
        }
      }

      scene.remove(meshToRemove);
      world.removeBody(bodyToRemove);

      sphereMeshes.splice(randomIndex, 1);
      sphereBodies.splice(randomIndex, 1);

      lastSphereRegenerationTimeRef.current = time;
    }

    function createNewSphere(time: number) {
      const radius =
        sphereConfig.smallMinRadius +
        Math.random() *
          (sphereConfig.smallMaxRadius - sphereConfig.smallMinRadius);
      const sphereColor = generateVibrantColor();

      const sphereMaterial = new THREE.MeshPhysicalMaterial({
        color: sphereColor,
        metalness: 0.7,
        roughness: 0.15,
        emissive: sphereColor.clone().multiplyScalar(0.6),
        emissiveIntensity: 0.7,
        clearcoat: 0.9,
        clearcoatRoughness: 0.1,
      });

      const sphereGeometry = new THREE.SphereGeometry(radius, 24, 24);
      const sphereMesh = new THREE.Mesh(sphereGeometry, sphereMaterial);
      sphereMesh.castShadow = true;
      sphereMesh.receiveShadow = true;

      const initialDir = calculateNewImpulseDirection();
      const initialDist = mainSphereRadius * 0.3;
      const position = new THREE.Vector3(
        initialDir.x * initialDist,
        initialDir.y * initialDist,
        initialDir.z * initialDist
      );

      sphereMesh.position.copy(position);
      sphereMesh.scale.set(0.01, 0.01, 0.01);
      scene.add(sphereMesh);

      const pointLight = new THREE.PointLight(sphereColor.getHex(), 2.0, 5);
      pointLight.position.copy(sphereMesh.position);
      scene.add(pointLight);

      const lightIndex = scene.children.indexOf(pointLight);

      sphereMesh.userData = {
        hasLight: true,
        lightIndex,
        isCueBall: false,
      } as SphereUserData;

      const sphereShape = new CANNON.Sphere(radius);
      const sphereBody = new CANNON.Body({
        mass: radius * 3,
        material: cannonMaterial,
        position: new CANNON.Vec3(position.x, position.y, position.z),
        linearDamping: physicsConfig.dampingFactor,
        angularDamping: physicsConfig.dampingFactor,
      });
      sphereBody.addShape(sphereShape);

      sphereBody.type = CANNON.Body.KINEMATIC;
      world.addBody(sphereBody);

      pendingNewSphereRef.current = {
        mesh: sphereMesh,
        body: sphereBody,
        startTime: time,
        initialPosition: position.clone(),
      };

      newSphereScaleRef.current = 0;
    }

    function updateNewSphereAnimation(time: number) {
      const pendingNewSphere = pendingNewSphereRef.current;
      if (!pendingNewSphere.mesh || !pendingNewSphere.body) return;

      const elapsed = time - pendingNewSphere.startTime;
      const duration = sphereConfig.popupDuration;

      if (elapsed <= duration) {
        const progress = elapsed / duration;
        const easedProgress = easeOutElastic(progress);

        const scale = easedProgress * sphereConfig.popupScale;
        pendingNewSphere.mesh.scale.set(scale, scale, scale);

        const userData = pendingNewSphere.mesh.userData as SphereUserData;
        if (userData.hasLight) {
          const light = scene.children[userData.lightIndex] as THREE.PointLight;
          if (light) {
            light.intensity = 2.0 + Math.sin(progress * Math.PI * 10) * 1.0;
          }
        }
      } else {
        const mesh = pendingNewSphere.mesh;
        const body = pendingNewSphere.body;

        mesh.scale.set(1, 1, 1);
        body.type = CANNON.Body.DYNAMIC;

        const direction = calculateNewImpulseDirection();
        const impulseVector = new CANNON.Vec3(
          direction.x * sphereConfig.newSphereImpulseFactor,
          direction.y * sphereConfig.newSphereImpulseFactor,
          direction.z * sphereConfig.newSphereImpulseFactor
        );
        body.applyImpulse(impulseVector, body.position);

        smallSphereMeshesRef.current.push(mesh);
        smallSphereBodiesRef.current.push(body);

        pendingNewSphereRef.current = {
          mesh: null,
          body: null,
          startTime: 0,
          initialPosition: new THREE.Vector3(),
        };
      }
    }

    function easeOutElastic(x: number): number {
      const c4 = (2 * Math.PI) / 3;

      if (x === 0 || x === 1) return x;
      return Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * c4) + 1;
    }

    const createInnerGlow = () => {
      const colors = [0x88ccff, 0xffaa88];

      for (let i = 0; i < 2; i++) {
        const geometry = new THREE.SphereGeometry(
          mainSphereRadius * 0.7,
          24,
          24
        );
        const material = new THREE.MeshBasicMaterial({
          color: colors[i],
          transparent: true,
          opacity: 0.15,
          side: THREE.BackSide,
        });

        const glowSphere = new THREE.Mesh(geometry, material);
        glowSphere.position.set(0, 0, 0);
        scene.add(glowSphere);

        const glowIndex = i;
        const glowUpdate = () => {
          if (!isActive) return;
          const time = Date.now() * 0.001;
          const scale = 0.8 + Math.sin(time * 0.3 + glowIndex) * 0.1;
          glowSphere.scale.set(scale, scale, scale);
          requestAnimationFrame(glowUpdate);
        };

        glowUpdate();
      }
    };

    createInnerGlow();

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.rotateSpeed = 0.8;
    controls.zoomSpeed = 0.8;
    controls.enablePan = false;
    controls.autoRotate = false;
    controls.minDistance = 7;
    controls.maxDistance = 15;
    controls.minPolarAngle = Math.PI * 0.1;
    controls.maxPolarAngle = Math.PI * 0.5;
    controlsRef.current = controls;

    const raycaster = new THREE.Raycaster();
    const handleMouseMove = (event: MouseEvent) => {
      mousePosition.current.x = (event.clientX / window.innerWidth) * 2 - 1;
      mousePosition.current.y = -(event.clientY / window.innerHeight) * 2 + 1;
    };

    let lastTime = 0;

    camera.position.set(0, 10, 0);
    camera.lookAt(0, 0, 0);

    const animate = (time: number) => {
      if (!isActive) return;

      const deltaTime = time - lastTime;
      lastTime = time;
      timeRef.current = time;

      const world = worldRef.current;
      const smallSphereMeshes = smallSphereMeshesRef.current;
      const smallSphereBodies = smallSphereBodiesRef.current;
      const mainSphereMesh = mainSphereMeshRef.current;

      if (!world || !mainSphereMesh) return;

      for (let i = 0; i < 2; i++) {
        world.step(physicsConfig.timeStep);
      }

      if (
        time - lastSphereRegenerationTimeRef.current >
        sphereConfig.regenerationInterval
      ) {
        if (
          smallSphereMeshes.length > Math.max(2, sphereConfig.smallCount / 2)
        ) {
          removeRandomSphere(time);
        }

        if (!pendingNewSphereRef.current.mesh) {
          createNewSphere(time);
        }
      }

      if (pendingNewSphereRef.current.mesh) {
        updateNewSphereAnimation(time);
      }

      applyCueBallImpulse(time);

      if (time % 120 === 0) {
        smallSphereBodies.forEach((body, index) => {
          if (index !== cueBallIndexRef.current && Math.random() > 0.5) {
            const currentVelocity = Math.sqrt(
              body.velocity.x * body.velocity.x +
                body.velocity.y * body.velocity.y +
                body.velocity.z * body.velocity.z
            );

            if (currentVelocity < 0.8) {
              const randomImpulse = new CANNON.Vec3(
                (Math.random() - 0.5) * 0.8,
                (Math.random() - 0.5) * 0.8,
                (Math.random() - 0.5) * 0.8
              );
              body.applyImpulse(randomImpulse, body.position);
            }
          }
        });
      }

      smallSphereBodies.forEach((body, index) => {
        if (index !== cueBallIndexRef.current) {
          const vel = body.velocity;
          const currentSpeed = Math.sqrt(
            vel.x * vel.x + vel.y * vel.y + vel.z * vel.z
          );

          const lastVel = lastVelocities[index];
          if (lastVel) {
            const velocityChange = Math.abs(
              currentSpeed -
                Math.sqrt(
                  lastVel.x * lastVel.x +
                    lastVel.y * lastVel.y +
                    lastVel.z * lastVel.z
                )
            );

            if (currentSpeed < 0.3 && velocityChange < 0.05) {
              stationaryTimes[index] += deltaTime;

              if (stationaryTimes[index] > 2000) {
                const toCenter = new CANNON.Vec3(
                  -body.position.x,
                  -body.position.y,
                  -body.position.z
                );
                toCenter.normalize();

                const randomDir = new CANNON.Vec3(
                  (Math.random() - 0.5) * 2,
                  (Math.random() - 0.5) * 2,
                  (Math.random() - 0.5) * 2
                );
                randomDir.normalize();

                const finalDir = new CANNON.Vec3(
                  toCenter.x * 0.8 + randomDir.x * 0.2,
                  toCenter.y * 0.8 + randomDir.y * 0.2,
                  toCenter.z * 0.8 + randomDir.z * 0.2
                );
                finalDir.normalize();

                const impulseStrength = 8 + Math.random() * 6;
                const impulseVector = new CANNON.Vec3(
                  finalDir.x * impulseStrength,
                  finalDir.y * impulseStrength,
                  finalDir.z * impulseStrength
                );

                body.applyImpulse(impulseVector, body.position);
                stationaryTimes[index] = 0;
              }
            } else {
              stationaryTimes[index] = 0;
            }
          }

          lastVelocities[index].copy(vel);
        }
      });

      raycaster.setFromCamera(mousePosition.current, camera);
      const intersects = raycaster.intersectObjects(smallSphereMeshes);

      if (intersects.length > 0) {
        const index = smallSphereMeshes.indexOf(
          intersects[0].object as THREE.Mesh
        );
        if (index !== -1 && index < smallSphereBodies.length) {
          const body = smallSphereBodies[index];

          const force = new CANNON.Vec3(
            (Math.random() - 0.5) * 10,
            (Math.random() - 0.5) * 10,
            (Math.random() - 0.5) * 10
          );
          body.applyImpulse(force, body.position);
        }
      }

      const effectiveRadius = sphereConfig.mainRadius * 0.9;
      const toRemove: number[] = [];

      smallSphereBodies.forEach((body, index) => {
        const centerDirection = new CANNON.Vec3(
          -body.position.x,
          -body.position.y,
          -body.position.z
        );

        const distanceFromCenter = Math.sqrt(
          body.position.x * body.position.x +
            body.position.y * body.position.y +
            body.position.z * body.position.z
        );

        if (
          distanceFromCenter >
          sphereConfig.mainRadius * physicsConfig.exitThreshold
        ) {
          if (index !== cueBallIndexRef.current) {
            toRemove.push(index);
          } else {
            body.position.scale(
              (effectiveRadius / distanceFromCenter) * 0.7,
              body.position
            );
            body.velocity.set(0, 0, 0);
          }
          return;
        }

        if (distanceFromCenter > 0) {
          centerDirection.scale(1 / distanceFromCenter, centerDirection);
        }

        const gravityCentral = centerDirection.clone();
        gravityCentral.scale(
          physicsConfig.centralGravityStrength,
          gravityCentral
        );
        body.applyForce(gravityCentral, new CANNON.Vec3(0, 0, 0));

        if (distanceFromCenter > effectiveRadius * 0.8) {
          const boundaryForce = centerDirection.clone();
          const boundaryFactor =
            Math.pow(
              (distanceFromCenter - effectiveRadius * 0.8) /
                (effectiveRadius * 0.2),
              2
            ) * physicsConfig.boundaryForceMultiplier;
          boundaryForce.scale(boundaryFactor, boundaryForce);
          body.applyForce(boundaryForce, new CANNON.Vec3(0, 0, 0));

          body.velocity.scale(0.95, body.velocity);
        }

        const maxVelocity = 12;
        const currentVelocity = Math.sqrt(
          body.velocity.x * body.velocity.x +
            body.velocity.y * body.velocity.y +
            body.velocity.z * body.velocity.z
        );

        if (currentVelocity > maxVelocity) {
          body.velocity.scale(maxVelocity / currentVelocity, body.velocity);
        }
      });

      for (let i = toRemove.length - 1; i >= 0; i--) {
        const indexToRemove = toRemove[i];

        if (indexToRemove < cueBallIndexRef.current) {
          cueBallIndexRef.current--;
        }

        const meshToRemove = smallSphereMeshes[indexToRemove];
        const bodyToRemove = smallSphereBodies[indexToRemove];

        const userData = meshToRemove.userData as SphereUserData;
        if (userData.hasLight && userData.lightIndex >= 0) {
          const lightToRemove = scene.children[
            userData.lightIndex
          ] as THREE.Light;
          if (lightToRemove) {
            scene.remove(lightToRemove);
          }
        }

        scene.remove(meshToRemove);
        world.removeBody(bodyToRemove);

        smallSphereMeshes.splice(indexToRemove, 1);
        smallSphereBodies.splice(indexToRemove, 1);
      }

      mainSphereMesh.rotation.x = time * 0.0001;
      mainSphereMesh.rotation.y = time * 0.0002;

      mainSphereMesh.position.set(0, 0, 0);

      const mainSpherePulse = Math.sin(time * 0.001) * 0.03 + 1;
      mainSphereMesh.scale.set(
        mainSpherePulse,
        mainSpherePulse,
        mainSpherePulse
      );

      particlesMesh.rotation.x = time * 0.0001;
      particlesMesh.rotation.y = time * 0.0002;

      smallSphereBodies.forEach((body, index) => {
        const sphereMesh = smallSphereMeshes[index];
        const material = sphereMesh.material as THREE.MeshPhysicalMaterial;
        const userData = sphereMesh.userData as SphereUserData;
        const isCueBall = userData.isCueBall;

        sphereMesh.position.set(
          body.position.x,
          body.position.y,
          body.position.z
        );

        if (userData.hasLight) {
          const light = scene.children[userData.lightIndex] as THREE.PointLight;
          if (light) {
            light.position.copy(sphereMesh.position);

            if (isCueBall) {
              light.intensity = 2.5 + Math.sin(time * 0.003) * 0.5;
            } else {
              light.intensity = 1.5 + Math.sin(time * 0.002 + index) * 0.3;
            }
          }
        }

        if (isCueBall) {
          material.emissiveIntensity = 0.7 + Math.sin(time * 0.003) * 0.2;
          const scalePulse = 1.0 + Math.sin(time * 0.003) * 0.03;
          sphereMesh.scale.set(scalePulse, scalePulse, scalePulse);
        } else {
          material.emissiveIntensity =
            0.4 + Math.sin(time * 0.001 + index * 0.2) * 0.15;
        }
      });

      controls.update();
      composer.render();

      requestAnimationFrame(animate);
    };

    const onResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
      composer.setSize(window.innerWidth, window.innerHeight);

      fxaaPass.material.uniforms["resolution"].value.x =
        1 / (window.innerWidth * renderer.getPixelRatio());
      fxaaPass.material.uniforms["resolution"].value.y =
        1 / (window.innerHeight * renderer.getPixelRatio());
    };

    window.addEventListener("resize", onResize);
    window.addEventListener("mousemove", handleMouseMove);

    const startZoom = () => {
      let startY = 100;
      let targetY = 7;
      let startTime = Date.now();
      let duration = 3000;

      const animateZoom = () => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
        const smoothProgress = easeOutCubic(progress);
        const newY = startY - (startY - targetY) * smoothProgress;
        camera.position.y = newY;
        camera.lookAt(0, 0, 0);

        if (progress < 1) {
          requestAnimationFrame(animateZoom);
        }
      };

      requestAnimationFrame(animateZoom);
    };

    setTimeout(startZoom, 1000);

    setTimeout(() => {
      smallSphereMeshesRef.current = smallSphereMeshes;
      smallSphereBodiesRef.current = smallSphereBodies;
      setIsLoading(false);
      animate(0);
    }, 500);

    return () => {
      setIsActive(false);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("mousemove", handleMouseMove);

      if (rendererRef.current) {
        rendererRef.current.dispose();
      }

      if (sceneRef.current) {
        sceneRef.current.clear();
      }

      if (worldRef.current && smallSphereBodies.length > 0) {
        smallSphereBodies.forEach((body: CANNON.Body) => {
          worldRef.current?.removeBody(body);
        });
      }

      if (container && rendererRef.current?.domElement) {
        try {
          container.removeChild(rendererRef.current.domElement);
        } catch (e) {}
      }
    };
  }, []);

  return (
    <div
      style={{
        width: "100%",
        height: "100vh",
        position: "absolute",
        overflow: "hidden",
        background: "linear-gradient(to bottom, #020618, #131b40)",
      }}
    >
      {isLoading && (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            background: "linear-gradient(to bottom, #020618, #131b40)",
            zIndex: 1000,
          }}
        >
          <div
            style={{
              width: "120px",
              height: "120px",
              position: "relative",
            }}
          >
            <div
              style={{
                position: "absolute",
                width: "100%",
                height: "100%",
                border: "8px solid transparent",
                borderTopColor: "#88ccff",
                borderRadius: "50%",
                animation: "spin 1.5s linear infinite",
              }}
            ></div>
            <div
              style={{
                position: "absolute",
                width: "100%",
                height: "100%",
                border: "8px solid transparent",
                borderLeftColor: "#ffaa88",
                borderRadius: "50%",
                animation: "spin 1.2s linear infinite reverse",
              }}
            ></div>
            <style>
              {`
                @keyframes spin {
                  0% { transform: rotate(0deg); }
                  100% { transform: rotate(360deg); }
                }
                @keyframes pulse {
                  0% { transform: scale(0.8); opacity: 0.3; }
                  50% { transform: scale(1.2); opacity: 0.8; }
                  100% { transform: scale(0.8); opacity: 0.3; }
                }
              `}
            </style>
            <div
              style={{
                position: "absolute",
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                width: "40%",
                height: "40%",
                borderRadius: "50%",
                background: "#ffffff",
                animation: "pulse 1.5s ease-in-out infinite",
              }}
            ></div>
          </div>
        </div>
      )}
      <div
        ref={containerRef}
        style={{
          width: "100%",
          height: "100vh",
          position: "absolute",
          overflow: "hidden",
        }}
      ></div>
    </div>
  );
};

export default GalacticSpheres;
