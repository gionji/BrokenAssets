
import * as THREE from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import { FragmentData } from '../types';

/**
 * Shatters a THREE.Mesh into multiple fragments and calculates distribution targets.
 * Optionally creates solid closed volumes using Convex Hull logic.
 */
export const shatterMesh = (
  mesh: THREE.Mesh,
  fragmentCount: number,
  volumeBounds?: THREE.Box3,
  makeSolid: boolean = false
): FragmentData[] => {
  const originalGeometry = mesh.geometry.clone();
  const geometry = originalGeometry.toNonIndexed();
  
  if (!geometry.attributes.position) return [];

  const positions = geometry.attributes.position.array;
  const triangleCount = positions.length / 9;
  
  geometry.computeBoundingBox();
  const bbox = geometry.boundingBox!;
  const meshCenter = new THREE.Vector3();
  bbox.getCenter(meshCenter);
  
  // Generate Shatter Seeds (Voronoi sites)
  const seeds: THREE.Vector3[] = [];
  for (let i = 0; i < fragmentCount; i++) {
    seeds.push(new THREE.Vector3(
      THREE.MathUtils.randFloat(bbox.min.x, bbox.max.x),
      THREE.MathUtils.randFloat(bbox.min.y, bbox.max.y),
      THREE.MathUtils.randFloat(bbox.min.z, bbox.max.z)
    ));
  }

  const fragments: { positions: number[], points: THREE.Vector3[] }[] = Array.from({ length: fragmentCount }, () => ({
    positions: [],
    points: []
  }));

  const triangleCentroid = new THREE.Vector3();
  for (let i = 0; i < triangleCount; i++) {
    const i9 = i * 9;
    
    // Triangle vertices
    const v1 = new THREE.Vector3(positions[i9], positions[i9 + 1], positions[i9 + 2]);
    const v2 = new THREE.Vector3(positions[i9 + 3], positions[i9 + 4], positions[i9 + 5]);
    const v3 = new THREE.Vector3(positions[i9 + 6], positions[i9 + 7], positions[i9 + 8]);

    triangleCentroid.set(
      (v1.x + v2.x + v3.x) / 3,
      (v1.y + v2.y + v3.y) / 3,
      (v1.z + v2.z + v3.z) / 3
    );

    let closestSeedIndex = 0;
    let minDist = Infinity;
    for (let s = 0; s < fragmentCount; s++) {
      const distSq = triangleCentroid.distanceToSquared(seeds[s]);
      if (distSq < minDist) {
        minDist = distSq;
        closestSeedIndex = s;
      }
    }

    for (let j = 0; j < 9; j++) {
      fragments[closestSeedIndex].positions.push(positions[i9 + j]);
    }
    // Collect points for convex hull
    fragments[closestSeedIndex].points.push(v1, v2, v3);
  }

  const results: FragmentData[] = [];
  const baseMaterial = (mesh.material as THREE.Material).clone();

  fragments.forEach((frag) => {
    if (frag.points.length < 4) return; // Need at least 4 points for a convex hull

    let fragGeo: THREE.BufferGeometry;
    
    if (makeSolid) {
      try {
        // Create a solid closed volume from the points
        fragGeo = new ConvexGeometry(frag.points);
      } catch (e) {
        // Fallback to shell if convex hull fails
        fragGeo = new THREE.BufferGeometry();
        fragGeo.setAttribute('position', new THREE.Float32BufferAttribute(frag.positions, 3));
      }
    } else {
      // Create a hollow shell from original triangles
      fragGeo = new THREE.BufferGeometry();
      fragGeo.setAttribute('position', new THREE.Float32BufferAttribute(frag.positions, 3));
    }

    fragGeo.computeVertexNormals();
    fragGeo.computeBoundingBox();

    const fragmentMesh = new THREE.Mesh(fragGeo, baseMaterial);
    fragmentMesh.position.copy(mesh.position);
    fragmentMesh.rotation.copy(mesh.rotation);
    fragmentMesh.scale.copy(mesh.scale);

    const fragCentroid = new THREE.Vector3();
    fragGeo.boundingBox!.getCenter(fragCentroid);
    const direction = fragCentroid.clone().sub(meshCenter).normalize();

    const targetPos = new THREE.Vector3();
    if (volumeBounds) {
      targetPos.set(
        THREE.MathUtils.randFloat(volumeBounds.min.x, volumeBounds.max.x),
        THREE.MathUtils.randFloat(volumeBounds.min.y, volumeBounds.max.y),
        THREE.MathUtils.randFloat(volumeBounds.min.z, volumeBounds.max.z)
      );
    } else {
      targetPos.copy(fragmentMesh.position).add(direction.clone().multiplyScalar(5));
    }

    results.push({
      mesh: fragmentMesh,
      centroid: fragCentroid,
      direction,
      originalPosition: fragmentMesh.position.clone(),
      targetVolumePosition: targetPos,
      originalRotation: fragmentMesh.rotation.clone(),
      rotationAxis: new THREE.Vector3(Math.random()-0.5, Math.random()-0.5, Math.random()-0.5).normalize()
    });
  });

  geometry.dispose();
  originalGeometry.dispose();
  return results;
};
