
import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import GUI from 'lil-gui';
import { shatterMesh } from '../services/shatterEngine';
import { FragmentData } from '../types';

interface ViewerProps {
  file: File | null;
}

interface Box2D {
  left: number;
  top: number;
  width: number;
  height: number;
  label: string;
}

interface DatasetSample {
  id: number;
  image: string; // base64
  annotations: string[]; // YOLO format strings
}

const Viewer: React.FC<ViewerProps> = ({ file }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const fragmentsRef = useRef<FragmentData[]>([]);
  const originalGroupRef = useRef<THREE.Group | null>(null);
  const fragmentGroupRef = useRef<THREE.Group | null>(null);
  const bboxGroupRef = useRef<THREE.Group | null>(null);
  const volumeGizmoRef = useRef<THREE.LineSegments | null>(null);
  const boxHelpersRef = useRef<THREE.BoxHelper[]>([]);
  const textureCacheRef = useRef<THREE.Texture[]>([]);
  const envTextureRef = useRef<THREE.Texture | null>(null);
  
  const [boxes2D, setBoxes2D] = useState<Box2D[]>([]);

  // Settings for lil-gui
  const settings = useRef({
    fragmentCount: 30,
    explosionForce: 0.2,
    rotationForce: 1.0,
    solidFragments: true,
    // Visualization
    showBBoxes3D: false,
    showBBoxes2D: true,
    // Volume
    useVolume: true,
    volumeX: 6,
    volumeY: 6,
    volumeZ: 6,
    showVolumeGizmo: true,
    // Environment
    backgroundBlur: 0.1,
    environmentIntensity: 1.0,
    randomizeBG: () => {},
    // Material
    useCustomMaterial: true,
    baseColor: '#0088ff',
    secondaryColor: '#ffffff',
    emissiveColor: '#000000',
    metalness: 0.5,
    roughness: 0.5,
    // Textures
    textureType: 'Grid', // None, Grid, Noise, Stripes
    textureScale: 4.0,
    randomizeHue: true,
    randomizeRoughness: true,
    // Dataset Generation
    batchN: 5,
    randomizeCamera: true,
    isGenerating: false,
    generateDataset: () => {},
    // State/Actions
    shattered: false,
    shatter: () => {},
    reShatter: () => {},
    reset: () => {},
    exportGLB: () => {}
  });

  // Helper to generate procedural textures
  const createProceduralTexture = (type: string, color1: string, color2: string, scale: number) => {
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;

    if (type === 'Grid') {
      ctx.fillStyle = color1;
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = color2;
      const step = size / (scale * 2);
      for (let y = 0; y < size; y += step * 2) {
        for (let x = 0; x < size; x += step * 2) {
          ctx.fillRect(x, y, step, step);
          ctx.fillRect(x + step, y + step, step, step);
        }
      }
    } else if (type === 'Stripes') {
      ctx.fillStyle = color1;
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = color2;
      const step = size / (scale * 2);
      for (let x = 0; x < size; x += step * 2) {
        ctx.fillRect(x, 0, step, size);
      }
    } else if (type === 'Noise') {
      ctx.fillStyle = color1;
      ctx.fillRect(0, 0, size, size);
      for (let i = 0; i < 2000 * scale; i++) {
        const x = Math.random() * size;
        const y = Math.random() * size;
        const r = Math.random() * (10 / scale);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = Math.random() > 0.5 ? color2 : color1;
        ctx.globalAlpha = Math.random() * 0.5;
        ctx.fill();
      }
      ctx.globalAlpha = 1.0;
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1, 1);
    textureCacheRef.current.push(texture);
    return texture;
  };

  useEffect(() => {
    if (!containerRef.current) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050505);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(8, 8, 8);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controlsRef.current = controls;

    // Lights
    scene.add(new THREE.AmbientLight(0xffffff, 0.2));
    const dLight = new THREE.DirectionalLight(0xffffff, 1.0);
    dLight.position.set(5, 10, 5);
    scene.add(dLight);
    
    // Groups
    const originalGroup = new THREE.Group();
    const fragmentGroup = new THREE.Group();
    const bboxGroup = new THREE.Group();
    scene.add(originalGroup, fragmentGroup, bboxGroup);
    originalGroupRef.current = originalGroup;
    fragmentGroupRef.current = fragmentGroup;
    bboxGroupRef.current = bboxGroup;

    // Volume Gizmo
    const volumeGeo = new THREE.BoxGeometry(1, 1, 1);
    const volumeEdges = new THREE.EdgesGeometry(volumeGeo);
    const volumeMat = new THREE.LineBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0.3 });
    const volumeGizmo = new THREE.LineSegments(volumeEdges, volumeMat);
    scene.add(volumeGizmo);
    volumeGizmoRef.current = volumeGizmo;

    const updateVolumeGizmo = () => {
      volumeGizmo.scale.set(settings.current.volumeX, settings.current.volumeY, settings.current.volumeZ);
      volumeGizmo.visible = settings.current.showVolumeGizmo;
    };
    updateVolumeGizmo();

    const loadRandomBackground = () => {
      const loader = new THREE.TextureLoader();
      const randomId = Math.floor(Math.random() * 1000);
      const url = `https://picsum.photos/id/${randomId}/2048/1024`;
      
      return new Promise<void>((resolve) => {
        loader.load(url, (texture) => {
          texture.mapping = THREE.EquirectangularReflectionMapping;
          texture.colorSpace = THREE.SRGBColorSpace;
          if (envTextureRef.current) envTextureRef.current.dispose();
          envTextureRef.current = texture;
          scene.background = texture;
          scene.environment = texture;
          scene.backgroundBlurriness = settings.current.backgroundBlur;
          scene.environmentIntensity = settings.current.environmentIntensity;
          resolve();
        }, undefined, () => {
          loader.load(`https://picsum.photos/2048/1024?random=${Date.now()}`, (texture) => {
             texture.mapping = THREE.EquirectangularReflectionMapping;
             scene.background = texture;
             scene.environment = texture;
             resolve();
          });
        });
      });
    };

    // GUI
    const gui = new GUI({ title: 'Shatter Studio Pro' });
    
    const envFolder = gui.addFolder('Environment & Lighting');
    settings.current.randomizeBG = () => loadRandomBackground();
    envFolder.add(settings.current, 'randomizeBG').name('🎲 RANDOM BACKGROUND');
    envFolder.add(settings.current, 'backgroundBlur', 0, 1).name('BG Blur').onChange((v: number) => {
      scene.backgroundBlurriness = v;
    });
    envFolder.add(settings.current, 'environmentIntensity', 0, 5).name('Env Intensity').onChange((v: number) => {
      scene.environmentIntensity = v;
    });

    const simFolder = gui.addFolder('Simulation');
    simFolder.add(settings.current, 'fragmentCount', 5, 300, 1).name('Fragment Count');
    simFolder.add(settings.current, 'solidFragments').name('Solid Geometry');
    simFolder.add(settings.current, 'explosionForce', 0, 1, 0.01).name('Scatter Intensity').onChange((v: number) => updateTransformations(v, settings.current.rotationForce));
    simFolder.add(settings.current, 'rotationForce', 0, 5, 0.01).name('Spin Velocity').onChange((v: number) => updateTransformations(settings.current.explosionForce, v));
    
    const volFolder = gui.addFolder('Scatter Volume');
    volFolder.add(settings.current, 'useVolume').name('Enabled');
    volFolder.add(settings.current, 'volumeX', 0, 20).name('Width (X)').onChange(updateVolumeGizmo);
    volFolder.add(settings.current, 'volumeY', 0, 20).name('Height (Y)').onChange(updateVolumeGizmo);
    volFolder.add(settings.current, 'volumeZ', 0, 20).name('Depth (Z)').onChange(updateVolumeGizmo);
    volFolder.add(settings.current, 'showVolumeGizmo').name('Show Gizmo').onChange(updateVolumeGizmo);

    const matFolder = gui.addFolder('Fragment Material');
    matFolder.add(settings.current, 'useCustomMaterial').name('Override Original');
    matFolder.addColor(settings.current, 'baseColor').name('Primary Color');
    matFolder.addColor(settings.current, 'secondaryColor').name('Secondary Color');
    matFolder.addColor(settings.current, 'emissiveColor').name('Emissive');
    matFolder.add(settings.current, 'textureType', ['None', 'Grid', 'Noise', 'Stripes']).name('Texture Mode');
    matFolder.add(settings.current, 'textureScale', 0.5, 20).name('Pattern Scale');
    matFolder.add(settings.current, 'metalness', 0, 1).name('Metalness');
    matFolder.add(settings.current, 'roughness', 0, 1).name('Roughness');
    matFolder.add(settings.current, 'randomizeHue').name('Randomize Colors');
    matFolder.add(settings.current, 'randomizeRoughness').name('Randomize Surfaces');

    const vizFolder = gui.addFolder('Visualization');
    vizFolder.add(settings.current, 'showBBoxes3D').name('3D Wireframes').onChange((v: boolean) => bboxGroup.visible = v);
    vizFolder.add(settings.current, 'showBBoxes2D').name('YOLO 2D Boxes');

    const datasetFolder = gui.addFolder('Dataset Generator');
    datasetFolder.add(settings.current, 'batchN', 1, 100, 1).name('Samples (N)');
    datasetFolder.add(settings.current, 'randomizeCamera').name('Random Viewpoint');
    
    settings.current.generateDataset = async () => {
      if (settings.current.isGenerating) return;
      settings.current.isGenerating = true;
      gui.domElement.style.pointerEvents = 'none';
      gui.domElement.style.opacity = '0.5';

      const results: DatasetSample[] = [];
      const n = settings.current.batchN;

      for (let i = 0; i < n; i++) {
        // 1. Randomize State
        performReShatter();
        if (settings.current.randomizeCamera) {
          const theta = Math.random() * Math.PI * 2;
          const phi = Math.random() * Math.PI * 0.5 + 0.1;
          const r = 6 + Math.random() * 8;
          camera.position.setFromSphericalCoords(r, phi, theta);
          camera.lookAt(0, 0, 0);
          controls.update();
        }
        await loadRandomBackground();

        // 2. Forced Render
        renderer.render(scene, camera);
        
        // 3. Capture RGB
        const base64Img = renderer.domElement.toDataURL('image/png');

        // 4. Capture YOLO BBoxes (synchronously calculated)
        const annotations: string[] = [];
        const width = window.innerWidth, height = window.innerHeight;

        fragmentsRef.current.forEach((f, idx) => {
          const box = new THREE.Box3().setFromObject(f.mesh);
          const corners = [
            new THREE.Vector3(box.min.x, box.min.y, box.min.z), new THREE.Vector3(box.min.x, box.min.y, box.max.z),
            new THREE.Vector3(box.min.x, box.max.y, box.min.z), new THREE.Vector3(box.min.x, box.max.y, box.max.z),
            new THREE.Vector3(box.max.x, box.min.y, box.min.z), new THREE.Vector3(box.max.x, box.min.y, box.max.z),
            new THREE.Vector3(box.max.x, box.max.y, box.min.z), new THREE.Vector3(box.max.x, box.max.y, box.max.z),
          ];
          
          let minX = 1, minY = 1, maxX = -1, maxY = -1;
          corners.forEach(c => {
            c.project(camera);
            minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x);
            minY = Math.min(minY, c.y); maxY = Math.max(maxY, c.y);
          });

          // Only add if visible in frustum
          if (maxX > -1 && minX < 1 && maxY > -1 && minY < 1) {
            // Normalize to 0-1 range
            const normMinX = Math.max(0, (minX + 1) / 2);
            const normMaxX = Math.min(1, (maxX + 1) / 2);
            const normMinY = Math.max(0, (1 - maxY) / 2);
            const normMaxY = Math.min(1, (1 - minY) / 2);

            const w = normMaxX - normMinX;
            const h = normMaxY - normMinY;
            const cx = normMinX + w / 2;
            const cy = normMinY + h / 2;

            // Format: class x_center y_center width height
            annotations.push(`0 ${cx.toFixed(6)} ${cy.toFixed(6)} ${w.toFixed(6)} ${h.toFixed(6)}`);
          }
        });

        results.push({ id: i, image: base64Img, annotations });
        
        // Small delay to keep UI responsive
        await new Promise(r => setTimeout(r, 100));
      }

      // Final Export
      const blob = new Blob([JSON.stringify(results, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `shatter_dataset_${Date.now()}.json`;
      link.click();
      URL.revokeObjectURL(url);

      settings.current.isGenerating = false;
      gui.domElement.style.pointerEvents = 'auto';
      gui.domElement.style.opacity = '1.0';
    };
    datasetFolder.add(settings.current, 'generateDataset').name('🚀 START BATCH GEN');

    settings.current.shatter = () => performShatter();
    settings.current.reShatter = () => performReShatter();
    settings.current.reset = () => resetModel();
    settings.current.exportGLB = () => exportModel();

    gui.add(settings.current, 'shatter').name('🚀 SHATTER');
    gui.add(settings.current, 'reShatter').name('🎲 RE-SHATTER (Randomize)');
    gui.add(settings.current, 'reset').name('↺ Reset Scene');
    gui.add(settings.current, 'exportGLB').name('💾 Export GLB');

    const performShatter = () => {
      if (!originalGroupRef.current || settings.current.shattered) return;
      
      const volumeBounds = new THREE.Box3().setFromCenterAndSize(
        new THREE.Vector3(0,0,0), 
        new THREE.Vector3(settings.current.volumeX, settings.current.volumeY, settings.current.volumeZ)
      );

      const newFragments: FragmentData[] = [];
      originalGroupRef.current.traverse((node) => {
        if ((node as THREE.Mesh).isMesh) {
          const mesh = node as THREE.Mesh;
          const frags = shatterMesh(
            mesh, 
            settings.current.fragmentCount, 
            settings.current.useVolume ? volumeBounds : undefined,
            settings.current.solidFragments
          );
          newFragments.push(...frags);
        }
      });

      if (newFragments.length > 0) {
        fragmentsRef.current = newFragments;
        originalGroupRef.current.visible = false;

        newFragments.forEach((f, i) => {
          if (settings.current.useCustomMaterial) {
            let color1 = settings.current.baseColor;
            let color2 = settings.current.secondaryColor;

            if (settings.current.randomizeHue) {
              const c1 = new THREE.Color(color1);
              const c2 = new THREE.Color(color2);
              const hShift = Math.random() * 0.1 - 0.05;
              c1.offsetHSL(hShift, 0, 0);
              c2.offsetHSL(hShift, 0, 0);
              color1 = '#' + c1.getHexString();
              color2 = '#' + c2.getHexString();
            }

            const mat = new THREE.MeshStandardMaterial({
              color: new THREE.Color(color1),
              emissive: new THREE.Color(settings.current.emissiveColor),
              metalness: settings.current.metalness,
              roughness: settings.current.roughness,
              flatShading: true,
              side: THREE.DoubleSide
            });

            if (settings.current.textureType !== 'None') {
              mat.map = createProceduralTexture(
                settings.current.textureType,
                color1,
                color2,
                settings.current.textureScale
              );
            }

            if (settings.current.randomizeRoughness) {
              mat.roughness = Math.random();
              mat.metalness = Math.random();
            }

            f.mesh.material = mat;
          } else {
            if (Array.isArray(f.mesh.material)) {
              f.mesh.material.forEach(m => m.side = THREE.DoubleSide);
            } else {
              f.mesh.material.side = THREE.DoubleSide;
            }
          }

          fragmentGroup.add(f.mesh);
          const helper = new THREE.BoxHelper(f.mesh, 0x00ffff);
          boxHelpersRef.current.push(helper);
          bboxGroup.add(helper);
        });

        bboxGroup.visible = settings.current.showBBoxes3D;
        settings.current.shattered = true;
        updateTransformations(settings.current.explosionForce, settings.current.rotationForce);
      }
    };

    const performReShatter = () => {
      fragmentsRef.current.forEach(f => {
        f.mesh.geometry.dispose();
        if (Array.isArray(f.mesh.material)) {
          f.mesh.material.forEach(m => m.dispose());
        } else {
          f.mesh.material.dispose();
        }
      });
      textureCacheRef.current.forEach(t => t.dispose());
      textureCacheRef.current = [];
      boxHelpersRef.current.forEach(h => h.geometry.dispose());
      boxHelpersRef.current = [];
      while(fragmentGroup.children.length > 0) fragmentGroup.remove(fragmentGroup.children[0]);
      while(bboxGroup.children.length > 0) bboxGroup.remove(bboxGroup.children[0]);
      fragmentsRef.current = [];
      setBoxes2D([]);
      
      settings.current.shattered = false;
      performShatter();
    };

    const resetModel = () => {
      fragmentsRef.current.forEach(f => {
        f.mesh.geometry.dispose();
        if (Array.isArray(f.mesh.material)) {
          f.mesh.material.forEach(m => m.dispose());
        } else {
          f.mesh.material.dispose();
        }
      });
      textureCacheRef.current.forEach(t => t.dispose());
      textureCacheRef.current = [];
      boxHelpersRef.current.forEach(h => h.geometry.dispose());
      boxHelpersRef.current = [];
      while(fragmentGroup.children.length > 0) fragmentGroup.remove(fragmentGroup.children[0]);
      while(bboxGroup.children.length > 0) bboxGroup.remove(bboxGroup.children[0]);
      fragmentsRef.current = [];
      setBoxes2D([]);
      originalGroup.visible = true;
      settings.current.shattered = false;
      gui.controllers.forEach(c => c.updateDisplay());
    };

    const updateTransformations = (force: number, rotForce: number) => {
      fragmentsRef.current.forEach((f, idx) => {
        if (settings.current.useVolume) {
          f.mesh.position.copy(f.originalPosition).lerp(f.targetVolumePosition, force);
        } else {
          f.mesh.position.copy(f.originalPosition).add(f.direction.clone().multiplyScalar(force * 12));
        }
        const q = new THREE.Quaternion().setFromAxisAngle(f.rotationAxis, force * 15 * rotForce);
        const originalQuat = new THREE.Quaternion().setFromEuler(f.originalRotation);
        f.mesh.quaternion.copy(q.multiply(originalQuat));
        if (boxHelpersRef.current[idx]) boxHelpersRef.current[idx].update();
      });
    };

    const calculate2DBboxes = () => {
      if (!settings.current.showBBoxes2D || !cameraRef.current || fragmentsRef.current.length === 0 || settings.current.isGenerating) {
        if (!settings.current.isGenerating) setBoxes2D(prev => prev.length > 0 ? [] : prev);
        return;
      }

      const width = window.innerWidth, height = window.innerHeight;
      const newBoxes: Box2D[] = [];
      
      fragmentsRef.current.forEach((f, i) => {
        const box = new THREE.Box3().setFromObject(f.mesh);
        const meshCenter = new THREE.Vector3();
        box.getCenter(meshCenter);
        const screenPos = meshCenter.clone().project(cameraRef.current!);
        
        if (Math.abs(screenPos.x) > 1.2 || Math.abs(screenPos.y) > 1.2) return;
        
        const corners = [
          new THREE.Vector3(box.min.x, box.min.y, box.min.z), new THREE.Vector3(box.min.x, box.min.y, box.max.z),
          new THREE.Vector3(box.min.x, box.max.y, box.min.z), new THREE.Vector3(box.min.x, box.max.y, box.max.z),
          new THREE.Vector3(box.max.x, box.min.y, box.min.z), new THREE.Vector3(box.max.x, box.min.y, box.max.z),
          new THREE.Vector3(box.max.x, box.max.y, box.min.z), new THREE.Vector3(box.max.x, box.max.y, box.max.z),
        ];
        
        let minX = 1, minY = 1, maxX = -1, maxY = -1;
        corners.forEach(c => {
          c.project(cameraRef.current!);
          minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x);
          minY = Math.min(minY, c.y); maxY = Math.max(maxY, c.y);
        });
        
        const left = (minX + 1) / 2 * width, right = (maxX + 1) / 2 * width;
        const top = (1 - maxY) / 2 * height, bottom = (1 - minY) / 2 * height;
        
        if (right > 0 && left < width && bottom > 0 && top < height) {
          const confidence = 0.9 + Math.random() * 0.09;
          newBoxes.push({ 
            left, top, 
            width: right - left, 
            height: bottom - top, 
            label: `FRAG_${i.toString().padStart(2, '0')} ${confidence.toFixed(2)}` 
          });
        }
      });
      setBoxes2D(newBoxes);
    };

    const animate = () => {
      requestAnimationFrame(animate);
      if (controlsRef.current) controlsRef.current.update();
      calculate2DBboxes();
      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
    };
    animate();

    const handleResize = () => {
      if (cameraRef.current && rendererRef.current) {
        cameraRef.current.aspect = window.innerWidth / window.innerHeight;
        cameraRef.current.updateProjectionMatrix();
        rendererRef.current.setSize(window.innerWidth, window.innerHeight);
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      gui.destroy();
      if (rendererRef.current) rendererRef.current.dispose();
      if (envTextureRef.current) envTextureRef.current.dispose();
    };
  }, []);

  useEffect(() => {
    if (!file || !sceneRef.current || !originalGroupRef.current) return;
    settings.current.reset();
    while(originalGroupRef.current.children.length > 0) originalGroupRef.current.remove(originalGroupRef.current.children[0]);
    const loader = new GLTFLoader();
    const url = URL.createObjectURL(file);
    loader.load(url, (gltf) => {
      const model = gltf.scene;
      const box = new THREE.Box3().setFromObject(model);
      const center = box.getCenter(new THREE.Vector3());
      model.position.sub(center);
      originalGroupRef.current?.add(model);
      const size = box.getSize(new THREE.Vector3()).length();
      const scale = 5 / size;
      originalGroupRef.current?.scale.set(scale, scale, scale);
      URL.revokeObjectURL(url);
    });
  }, [file]);

  const exportModel = () => {
    if (!fragmentGroupRef.current || fragmentGroupRef.current.children.length === 0) return alert("Shatter the mesh first!");
    const exporter = new GLTFExporter();
    exporter.parse(fragmentGroupRef.current, (result) => {
      const blob = result instanceof ArrayBuffer ? new Blob([result], { type: 'application/octet-stream' }) : new Blob([JSON.stringify(result)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = 'shattered_export.glb'; link.click();
      URL.revokeObjectURL(url);
    }, (e) => console.error(e), { binary: true });
  };

  return (
    <div ref={containerRef} className="w-full h-full relative">
      <svg className="absolute inset-0 w-full h-full pointer-events-none z-10 overflow-hidden">
        {boxes2D.map((box, i) => (
          <g key={i}>
            <rect x={box.left} y={box.top} width={box.width} height={box.height} fill="none" stroke="#00ff00" strokeWidth="1" className="opacity-60" />
            <rect x={box.left} y={box.top - 14} width={Math.max(box.label.length * 6, 80)} height={14} fill="#00ff00" />
            <text x={box.left + 4} y={box.top - 4} fill="black" fontSize="9px" fontWeight="bold" fontFamily="monospace">{box.label}</text>
          </g>
        ))}
      </svg>
      {/* Generation Loader Overlay */}
      {settings.current.isGenerating && (
        <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center z-50 pointer-events-auto">
          <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4"></div>
          <p className="text-blue-400 font-bold tracking-widest uppercase animate-pulse">Generating Batch Dataset...</p>
          <p className="text-white/40 text-xs mt-2 italic">Capturing RGB frames & YOLO labels. Please wait.</p>
        </div>
      )}
    </div>
  );
};

export default Viewer;
