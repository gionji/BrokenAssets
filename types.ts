
import * as THREE from 'three';

export interface FragmentData {
  mesh: THREE.Mesh;
  centroid: THREE.Vector3;
  direction: THREE.Vector3;
  originalPosition: THREE.Vector3;
  targetVolumePosition: THREE.Vector3; // The random target inside the custom volume
  originalRotation: THREE.Euler;
  rotationAxis: THREE.Vector3;
}

export interface ShatterOptions {
  fragmentCount: number;
  explosionForce: number;
  rotationForce: number;
  useVolume: boolean;
  volumeSize: THREE.Vector3;
}
