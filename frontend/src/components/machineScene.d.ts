import type { Group, PerspectiveCamera, Scene, WebGLRenderer } from 'three'
export function makeStage(canvas: HTMLCanvasElement, w: number, h: number, bg?: number): { renderer: WebGLRenderer; scene: Scene; camera: PerspectiveCamera }
export function fitModel<T extends import('three').Object3D>(obj: T): T
export function zoneMarkers(names: string[], color: number): Group
