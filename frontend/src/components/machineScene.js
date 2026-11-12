// 상세 팝업 3D 장면 도우미: 무대(조명·바닥) 만들기, 모델 크기 맞추기, 이상 부위 표시
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'

export function makeStage(canvas, w, h, bg = 0xf3f4f6) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); renderer.setSize(w, h, false)
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05
  const scene = new THREE.Scene(); scene.background = new THREE.Color(bg)
  const camera = new THREE.PerspectiveCamera(28, w / h, 0.1, 100)
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb8bcc4, 0.9))
  const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(4, 8, 6); key.castShadow = true
  key.shadow.mapSize.set(2048, 2048); Object.assign(key.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5 }); key.shadow.radius = 6; key.shadow.bias = -0.0005
  scene.add(key)
  const fill = new THREE.DirectionalLight(0xdfe8ff, 0.7); fill.position.set(-6, 3, -4); scene.add(fill)
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: 0.18 }))
  floor.rotation.x = -Math.PI / 2; floor.position.y = -0.04; floor.receiveShadow = true; scene.add(floor)
  return { renderer, scene, camera }
}

// ── 사진에서 만든 3D 모델(GLB)용 ─────────────────────────────
/** 모델을 가로 6 크기로 맞추고 바닥 가운데에 놓는다 (사출부가 +x, 앞면이 +z) */
export function fitModel(obj) {
  const b = new THREE.Box3().setFromObject(obj); const s = b.getSize(new THREE.Vector3())
  obj.scale.setScalar(6 / Math.max(s.x, s.y, s.z))
  const b2 = new THREE.Box3().setFromObject(obj); const c = b2.getCenter(new THREE.Vector3())
  obj.position.x -= c.x; obj.position.z -= c.z; obj.position.y -= b2.min.y
  obj.traverse((o) => { if (o.isMesh) { o.castShadow = o.receiveShadow = true } })
  return obj
}
/** 이상 부위 위치 (fitModel 기준 좌표). 모델이 한 덩어리라 부위를 반투명 색 덩어리로 감싼다 */
export const ZONE_BOX = {
  barrel: { at: [1.0, 1.36, 0.0], size: [1.45, 0.78, 0.8], round: true },
  screw: { at: [1.97, 1.3, 0.0], size: [0.82, 0.72, 0.85] },
  hydraulic: { at: [2.66, 1.32, 0.0], size: [0.58, 0.8, 0.95] },
  mold: { at: [-1.3, 1.35, 0.0], size: [1.1, 1.1, 1.1] },
}
export function zoneMarkers(names, color) {
  const g = new THREE.Group()
  for (const k of names) {
    const z = ZONE_BOX[k]; if (!z) continue
    const [w, h, d] = z.size
    const geo = z.round ? new THREE.CapsuleGeometry(h / 2, Math.max(w - h, 0.01), 8, 24).rotateZ(Math.PI / 2) : new RoundedBoxGeometry(w, h, d, 4, 0.12)
    const fill = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.38, depthWrite: false }))
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 35), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }))
    fill.position.set(...z.at); edge.position.set(...z.at); fill.renderOrder = 2; edge.renderOrder = 3
    g.add(fill, edge)
  }
  return g
}
