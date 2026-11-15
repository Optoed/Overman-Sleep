'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';

export default function WireWorld({ active, reduced }: { active: boolean; reduced: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = host.current;
    if (!container || !('WebGLRenderingContext' in window || 'WebGL2RenderingContext' in window)) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' }); }
    catch { return; } // The experience also works on devices without WebGL.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    container.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, .1, 100);
    camera.position.z = 8;
    const sculpture = new THREE.Group();
    scene.add(sculpture);
    const geometry = new THREE.BoxGeometry(2.9, 2.9, 2.9);
    const edges = new THREE.EdgesGeometry(geometry);
    const materials: THREE.LineBasicMaterial[] = [];
    for (let i = 0; i < 5; i++) {
      const material = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: .09 - i * .011 });
      materials.push(material);
      const cube = new THREE.LineSegments(edges, material);
      cube.scale.setScalar(1 - i * .145);
      cube.rotation.set(i * .17, i * .23, i * .08);
      sculpture.add(cube);
    }
    const points = new Float32Array(95 * 3);
    for (let i = 0; i < points.length; i += 3) {
      points[i] = (Math.random() - .5) * 20;
      points[i + 1] = (Math.random() - .5) * 14;
      points[i + 2] = (Math.random() - .5) * 8 - 3;
    }
    const particlesGeometry = new THREE.BufferGeometry();
    particlesGeometry.setAttribute('position', new THREE.BufferAttribute(points, 3));
    const particlesMaterial = new THREE.PointsMaterial({ color: 0xffffff, size: .013, transparent: true, opacity: .26 });
    const stars = new THREE.Points(particlesGeometry, particlesMaterial);
    scene.add(stars);
    const cursor = { x: 0, y: 0 };
    const onMove = (event: PointerEvent) => {
      cursor.x = event.clientX / window.innerWidth - .5;
      cursor.y = event.clientY / window.innerHeight - .5;
    };
    const resize = () => {
      renderer.setSize(container.clientWidth, container.clientHeight);
      camera.aspect = container.clientWidth / Math.max(1, container.clientHeight);
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container); resize();
    if (!reduced) window.addEventListener('pointermove', onMove, { passive: true });
    let frame = 0, lastFrame = 0;
    const animate = (time: number) => {
      frame = requestAnimationFrame(animate);
      if (document.hidden || time - lastFrame < 32) return;
      lastFrame = time;
      sculpture.rotation.x = .4 + (reduced ? 0 : time * .00007 + cursor.y * .15);
      sculpture.rotation.y = -.5 + (reduced ? 0 : time * .00009 + cursor.x * .2);
      sculpture.rotation.z = .2;
      camera.position.x += (cursor.x * .3 - camera.position.x) * .035;
      renderer.render(scene, camera);
    };
    if (reduced) { sculpture.rotation.set(.4, -.5, .2); renderer.render(scene, camera); }
    else frame = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener('pointermove', onMove);
      geometry.dispose(); edges.dispose(); materials.forEach(material => material.dispose());
      particlesGeometry.dispose(); particlesMaterial.dispose(); renderer.dispose(); renderer.domElement.remove();
    };
  }, [reduced]);
  return <div ref={host} className={`intro-world ${active ? 'intro-world-active' : ''}`} aria-hidden="true"/>;
}
