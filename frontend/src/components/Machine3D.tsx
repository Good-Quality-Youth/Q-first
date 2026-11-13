import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import type { AlertGroup, MachineZone } from '../api/types'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
// ?url: 일반 빌드는 별도 파일 주소, 한 파일 빌드(공유 링크)는 data URI로 들어온다
import texUrl from '../assets/machine-tex.jpg?url'
import glbUrl from '../assets/machine.glb?url'
import { fitModel, makeStage, zoneMarkers } from './machineScene'

/** 모델 파일 읽기: 공유 링크(data URI)는 직접 풀고, 일반 배포는 처음 상세를 열 때 한 번 받아 온다 */
async function loadGlb(url: string): Promise<ArrayBuffer> {
  if (url.startsWith('data:')) return Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), (c) => c.charCodeAt(0)).buffer
  const res = await fetch(url)
  if (!res.ok) throw new Error(`3D 모델을 받지 못함 (${res.status})`)
  return res.arrayBuffer()
}

const LABEL: Record<MachineZone, string> = { hydraulic: '유압', barrel: '배럴', screw: '스크류 구동', mold: '금형' }
/** 이상 부위가 잘 보이는 시작 각도 (사출부는 오른쪽 앞, 금형은 왼쪽 앞) */
const VIEW: Record<MachineZone, [number, number, number]> = { barrel: [6.0, 3.3, 7.1], hydraulic: [7.6, 3.2, 5.6], screw: [7.2, 3.4, 6.1], mold: [-5.5, 3.3, 7.6] }

const ALL: MachineZone[] = ['hydraulic', 'barrel', 'screw', 'mold']
const INK = 0x17191c

/** 상세 팝업용 사출기 3D(사진에서 만든 모델): 끌어서 돌려 보고, 이상 부위는 상태색 덩어리로 감싸 표시한다.
 *  focus를 주면 그 구역만 또렷하게 하고 그쪽으로 시점을 옮긴다(확인 항목의 위치 보기). WebGL이 안 되면 fallback */
export function Machine3D({ zones, group, focus = null, width = 420, height = 250, fallback }: { zones: MachineZone[]; group: AlertGroup; focus?: MachineZone | null; width?: number; height?: number; fallback?: React.ReactNode }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [failed, setFailed] = useState(false)
  const key = zones.join(',')
  const marks = useRef<Partial<Record<MachineZone, THREE.Group>>>({})
  const goal = useRef<THREE.Vector3 | null>(null)
  const focusRef = useRef(focus)
  focusRef.current = focus
  /** 구역 표시 갱신: 이상 부위는 늘 보이고, 확인 위치는 또렷하게, 나머지는 흐리게 */
  const apply = (f: MachineZone | null) => {
    for (const z of ALL) {
      const g = marks.current[z]; if (!g) continue
      const own = zones.includes(z)
      g.visible = own || f === z
      const [fill, edge] = !f ? [0.38, 0.9] : f === z ? [0.5, 1] : [0.12, 0.3]
      g.children.forEach((o) => { const m = (o as THREE.Mesh).material as THREE.Material & { opacity: number }; m.opacity = o instanceof THREE.LineSegments ? edge : fill })
    }
    goal.current = new THREE.Vector3(...VIEW[f ?? zones[0] ?? 'barrel'])
  }
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    let raf = 0
    let alive = true
    let dispose = () => {}
    try {
      const { renderer, scene, camera } = makeStage(canvas, width, height, 0xf3f4f6)
      const pmrem = new THREE.PMREMGenerator(renderer)
      scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
      scene.environmentIntensity = 0.45
      renderer.toneMappingExposure = 0.82
      const tex = new THREE.TextureLoader().load(texUrl)
      tex.flipY = false; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = renderer.capabilities.getMaxAnisotropy()
      loadGlb(glbUrl).then((buf) => new GLTFLoader().parse(buf, '', (g) => {
        if (!alive) return
        g.scene.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined; if (m) { m.map = tex; m.needsUpdate = true } })
        scene.add(fitModel(g.scene))
      }, () => setFailed(true))).catch(() => setFailed(true))
      // 구역마다 따로 만들어 두고 보이기·진하기만 바꾼다. 이상 부위는 상태색, 확인 위치만 짚는 구역은 검정
      marks.current = {}
      for (const z of ALL) { const m = zoneMarkers([z], zones.includes(z) ? (group === 'warning' ? 0x1463ff : 0xf01e2c) : INK); marks.current[z] = m; scene.add(m) }
      camera.position.set(...VIEW[zones[0] ?? 'barrel'])
      const controls = new OrbitControls(camera, canvas)
      controls.target.set(0.2, 0.85, 0)
      controls.enablePan = false; controls.enableDamping = true
      controls.minDistance = 4.5; controls.maxDistance = 16; controls.maxPolarAngle = Math.PI / 2 - 0.05
      controls.update()
      controls.addEventListener('start', () => { goal.current = null }) // 사용자가 돌리기 시작하면 자동 이동을 멈춘다
      apply(focusRef.current)
      if (!focusRef.current) goal.current = null
      const tick = () => {
        if (goal.current) { camera.position.lerp(goal.current, 0.08); if (camera.position.distanceTo(goal.current) < 0.02) goal.current = null }
        controls.update(); renderer.render(scene, camera); raf = requestAnimationFrame(tick)
      }
      tick()
      dispose = () => { alive = false; cancelAnimationFrame(raf); controls.dispose(); pmrem.dispose(); renderer.dispose() }
    } catch {
      setFailed(true)
    }
    return () => dispose()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, group, width, height])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { apply(focus) }, [focus])
  if (failed) return <>{fallback}</>
  return (
    <div className="relative shrink-0 overflow-hidden rounded-lg bg-soft" style={{ width, height }}>
      <canvas ref={ref} style={{ width, height, cursor: 'grab', touchAction: 'none' }} aria-label={`사출기 3D · 이상 부위 ${zones.map((z) => LABEL[z]).join('·')}`} />
      <span className={`pointer-events-none absolute left-3 top-2.5 text-[13px] font-bold ${focus && !zones.includes(focus) ? 'text-ink' : group === 'warning' ? 'text-blue-tx' : 'text-red-tx'}`}>{focus ? `확인 위치 · ${LABEL[focus]}` : `이상 부위 ${zones.map((z) => LABEL[z]).join(' · ')}`}</span>
      <span className="pointer-events-none absolute bottom-2 right-3 text-[11px] text-mute">끌어서 돌려 보기</span>
    </div>
  )
}
