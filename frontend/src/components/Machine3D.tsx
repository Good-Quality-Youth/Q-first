import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import type { AlertGroup, MachineZone } from '../api/types'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import texUrl from '../assets/machine-tex.jpg?inline'
import glbData from '../assets/machine.glb?inline'
import { fitModel, makeStage, zoneMarkers } from './machineScene'

const LABEL: Record<MachineZone, string> = { hydraulic: '유압', barrel: '배럴', screw: '스크류 구동', mold: '금형' }
/** 이상 부위가 잘 보이는 시작 각도 (사출부는 오른쪽 앞, 금형은 왼쪽 앞) */
const VIEW: Record<MachineZone, [number, number, number]> = { barrel: [6.0, 3.3, 7.1], hydraulic: [7.6, 3.2, 5.6], screw: [7.2, 3.4, 6.1], mold: [-5.5, 3.3, 7.6] }

/** 상세 팝업용 사출기 3D(사진에서 만든 모델): 끌어서 돌려 보고, 이상 부위는 상태색 덩어리로 감싸 표시한다. WebGL이 안 되면 fallback */
export function Machine3D({ zones, group, width = 420, height = 250, fallback }: { zones: MachineZone[]; group: AlertGroup; width?: number; height?: number; fallback?: React.ReactNode }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [failed, setFailed] = useState(false)
  const key = zones.join(',')
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
      // 모델·텍스처를 data URI로 넣어 두고 직접 푼다 (fetch·blob을 쓰지 않아 공유 페이지에서도 동작)
      const bin = Uint8Array.from(atob(glbData.slice(glbData.indexOf(',') + 1)), (c) => c.charCodeAt(0))
      const tex = new THREE.TextureLoader().load(texUrl)
      tex.flipY = false; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = renderer.capabilities.getMaxAnisotropy()
      new GLTFLoader().parse(bin.buffer, '', (g) => {
        if (!alive) return
        g.scene.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined; if (m) { m.map = tex; m.needsUpdate = true } })
        scene.add(fitModel(g.scene))
      }, () => setFailed(true))
      scene.add(zoneMarkers(zones, group === 'warning' ? 0x1463ff : 0xf01e2c))
      camera.position.set(...VIEW[zones[0] ?? 'barrel'])
      const controls = new OrbitControls(camera, canvas)
      controls.target.set(0.2, 0.85, 0)
      controls.enablePan = false; controls.enableDamping = true
      controls.minDistance = 4.5; controls.maxDistance = 16; controls.maxPolarAngle = Math.PI / 2 - 0.05
      controls.update()
      const tick = () => { controls.update(); renderer.render(scene, camera); raf = requestAnimationFrame(tick) }
      tick()
      dispose = () => { alive = false; cancelAnimationFrame(raf); controls.dispose(); pmrem.dispose(); renderer.dispose() }
    } catch {
      setFailed(true)
    }
    return () => dispose()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, group, width, height])
  if (failed) return <>{fallback}</>
  return (
    <div className="relative shrink-0 overflow-hidden rounded-lg bg-soft" style={{ width, height }}>
      <canvas ref={ref} style={{ width, height, cursor: 'grab', touchAction: 'none' }} aria-label={`사출기 3D · 이상 부위 ${zones.map((z) => LABEL[z]).join('·')}`} />
      <span className={`pointer-events-none absolute left-3 top-2.5 text-[13px] font-bold ${group === 'warning' ? 'text-blue-tx' : 'text-red-tx'}`}>이상 부위 {zones.map((z) => LABEL[z]).join(' · ')}</span>
      <span className="pointer-events-none absolute bottom-2 right-3 text-[11px] text-mute">끌어서 돌려 보기</span>
    </div>
  )
}
