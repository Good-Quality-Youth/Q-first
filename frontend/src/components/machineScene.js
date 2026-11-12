// 부품별로 나뉜 가로형 사출기 3D 모델 (three.js 도형 조합). zone 이름: mold / barrel / screw / hydraulic
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'

const M = {
  white: () => new THREE.MeshStandardMaterial({ color: 0xe9e7e0, roughness: 0.55, metalness: 0.05 }),
  gray: () => new THREE.MeshStandardMaterial({ color: 0x5b6067, roughness: 0.6, metalness: 0.2 }),
  dark: () => new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.5, metalness: 0.3 }),
  steel: () => new THREE.MeshStandardMaterial({ color: 0xc9ccd1, roughness: 0.22, metalness: 0.95 }),
  band: () => new THREE.MeshStandardMaterial({ color: 0x8d9198, roughness: 0.35, metalness: 0.85 }),
  glass: () => new THREE.MeshPhysicalMaterial({ color: 0x9fb4c4, roughness: 0.05, metalness: 0, transmission: 0.85, transparent: true, opacity: 0.35, thickness: 0.02 }),
  screen: () => new THREE.MeshStandardMaterial({ color: 0x1b2a3a, roughness: 0.2, metalness: 0.1, emissive: 0x16324d, emissiveIntensity: 0.6 }),
}
const box = (w, h, d, m, r = 0.03) => { const o = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, r), m); o.castShadow = o.receiveShadow = true; return o }
const cyl = (rt, rb, len, m, seg = 40) => { const o = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, len, seg), m); o.castShadow = o.receiveShadow = true; return o }
const xcyl = (r, len, m, r2 = r) => { const o = cyl(r, r2, len, m); o.rotation.z = Math.PI / 2; return o }
const at = (o, x, y, z = 0) => { o.position.set(x, y, z); return o }

export function buildMachine() {
  const g = new THREE.Group()
  const zone = { mold: new THREE.Group(), barrel: new THREE.Group(), screw: new THREE.Group(), hydraulic: new THREE.Group() }
  Object.entries(zone).forEach(([k, z]) => { z.name = k; g.add(z) })
  const body = new THREE.Group(); body.name = 'body'; g.add(body)

  // ── 베드 ──
  body.add(at(box(6.2, 0.62, 1.5, M.gray(), 0.04), 0, 0.41))
  body.add(at(box(6.3, 0.1, 1.58, M.dark(), 0.02), 0, 0.08))
  for (const x of [-2.8, -1.4, 0, 1.4, 2.8]) for (const z of [-0.68, 0.68]) body.add(at(cyl(0.09, 0.11, 0.08, M.dark(), 20), x, 0.0, z))
  // 베드 앞면 패널 줄눈 (왼쪽 절반)
  for (const x of [-2.4, -1.5, -0.6]) body.add(at(box(0.82, 0.4, 0.02, M.dark(), 0.01), x, 0.42, 0.755))
  // 오른쪽 하부 캐비닛(흰 문짝)
  body.add(at(box(2.75, 0.5, 1.42, M.white(), 0.03), 1.65, 0.93))
  for (const x of [0.75, 1.65, 2.55]) { body.add(at(box(0.84, 0.4, 0.02, M.white(), 0.01), x, 0.93, 0.72)); body.add(at(box(0.3, 0.07, 0.03, M.dark(), 0.005), x, 0.82, 0.725)) }

  // ── 형체부 (왼쪽) ──
  const y0 = 0.72
  // 끝판 + 형체 실린더
  body.add(at(box(0.28, 1.25, 1.3, M.white(), 0.05), -2.85, y0 + 0.66))
  body.add(at(xcyl(0.2, 0.42, M.white()), -3.15, y0 + 0.66))
  // 고정판·이동판
  body.add(at(box(0.22, 1.2, 1.25, M.white(), 0.04), -0.35, y0 + 0.64))
  body.add(at(box(0.2, 1.1, 1.15, M.white(), 0.04), -1.55, y0 + 0.62))
  // 타이바 4개
  for (const y of [0.22, 1.08]) for (const z of [-0.45, 0.45]) body.add(at(xcyl(0.055, 2.75, M.steel()), -1.6, y0 + y, z))
  // 토글 링크
  for (const s of [1, -1]) { const l = box(1.0, 0.13, 0.5, M.white(), 0.03); l.rotation.z = s * 0.42; body.add(at(l, -2.2, y0 + 0.66 + s * 0.2)) }
  // 금형 (zone)
  zone.mold.add(at(box(0.34, 0.72, 0.8, M.steel(), 0.015), -0.66, y0 + 0.64))
  zone.mold.add(at(box(0.34, 0.72, 0.8, M.band(), 0.015), -1.26, y0 + 0.64))
  // 안전문 프레임 + 유리
  const fx0 = -2.62, fx1 = -0.16, fw = fx1 - fx0, fy = y0 + 0.7
  for (const z of [0.7, -0.7]) {
    body.add(at(box(fw, 0.1, 0.06, M.white(), 0.02), (fx0 + fx1) / 2, fy + 0.66, z))
    body.add(at(box(fw, 0.12, 0.06, M.white(), 0.02), (fx0 + fx1) / 2, fy - 0.64, z))
    for (const x of [fx0, (fx0 + fx1) / 2, fx1]) body.add(at(box(0.1, 1.4, 0.06, M.white(), 0.02), x, fy, z))
    for (const x of [fx0 + fw / 4, fx1 - fw / 4]) body.add(at(box(fw / 2 - 0.1, 1.2, 0.015, M.glass(), 0.005), x, fy, z))
  }
  body.add(at(box(fw + 0.1, 0.06, 1.46, M.white(), 0.02), (fx0 + fx1) / 2, fy + 0.72))
  for (const x of [-1.47, -1.31]) body.add(at(box(0.03, 0.4, 0.04, M.dark(), 0.01), x, fy, 0.74))

  // ── 조작반 ──
  body.add(at(box(0.36, 1.25, 0.2, M.white(), 0.03), 0.1, y0 + 0.62, 0.66))
  body.add(at(box(0.26, 0.3, 0.02, M.screen(), 0.01), 0.1, y0 + 0.95, 0.765))
  body.add(at(box(0.26, 0.14, 0.02, M.dark(), 0.01), 0.1, y0 + 0.68, 0.765))

  // ── 사출부 (오른쪽) ──
  const by = 1.52
  body.add(at(box(2.5, 0.07, 0.5, M.gray(), 0.015), 1.7, 1.215))  // 슬라이드 레일
  body.add(at(box(0.3, 0.22, 0.4, M.gray(), 0.02), 1.5, 1.33))
  // 노즐 + 배럴 + 히터 밴드 (zone)
  zone.barrel.add(at(xcyl(0.045, 0.2, M.steel(), 0.1), -0.02, by))
  zone.barrel.add(at(xcyl(0.11, 1.45, M.steel()), 0.8, by))
  for (let i = 0; i < 5; i++) {
    zone.barrel.add(at(xcyl(0.15, 0.2, M.band()), 0.24 + i * 0.27, by))
    zone.barrel.add(at(box(0.06, 0.06, 0.05, M.dark(), 0.01), 0.24 + i * 0.27, by + 0.16))
  }
  // 호퍼 목 + 호퍼
  body.add(at(box(0.3, 0.3, 0.32, M.white(), 0.03), 1.62, by))
  body.add(at(cyl(0.07, 0.07, 0.2, M.steel()), 1.62, by + 0.24))
  body.add(at(cyl(0.3, 0.07, 0.42, M.steel()), 1.62, by + 0.54))
  body.add(at(cyl(0.3, 0.3, 0.2, M.steel()), 1.62, by + 0.85))
  body.add(at(cyl(0.31, 0.31, 0.02, M.band()), 1.62, by + 0.955))
  // 스크류 구동부 (zone)
  zone.screw.add(at(box(0.55, 0.5, 0.56, M.white(), 0.05), 2.08, by))
  zone.screw.add(at(cyl(0.16, 0.16, 0.34, M.gray()), 2.08, by + 0.4))
  zone.screw.add(at(cyl(0.17, 0.17, 0.03, M.dark()), 2.08, by + 0.58))
  // 사출 실린더(유압) (zone)
  for (const z of [-0.2, 0.2]) zone.hydraulic.add(at(xcyl(0.085, 0.75, M.steel()), 2.7, by, z))
  zone.hydraulic.add(at(box(0.16, 0.42, 0.6, M.white(), 0.03), 3.02, by))
  zone.hydraulic.add(at(box(0.5, 0.2, 0.4, M.gray(), 0.03), 2.65, by - 0.22))
  // 유압 호스
  const hose = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(2.95, by + 0.2, 0.25), new THREE.Vector3(3.2, by + 0.25, 0.45), new THREE.Vector3(3.22, 1.0, 0.6), new THREE.Vector3(3.0, 0.75, 0.7)]), 24, 0.03, 10), M.dark())
  hose.castShadow = true; zone.hydraulic.add(hose)

  g.userData.zones = zone
  return g
}

/** 이상 부위 칠하기: color = 0xF01E2C(비상) / 0x1463FF(예고) */
export function highlight(machine, names, color) {
  for (const [k, z] of Object.entries(machine.userData.zones)) {
    const on = names.includes(k)
    z.traverse((o) => {
      if (!o.isMesh) return
      if (!o.userData.base) o.userData.base = o.material
      o.material = on ? new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.3, emissive: color, emissiveIntensity: 0.35 }) : o.userData.base
    })
  }
}

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
