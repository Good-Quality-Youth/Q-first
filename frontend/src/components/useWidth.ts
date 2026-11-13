import { useEffect, useState } from 'react'

/** 요소의 실제 가로 폭(px)을 잰다. 그래프·3D처럼 픽셀 크기가 필요한 것을 화면 폭에 맞출 때 쓴다.
 *  콜백 ref라서 요소가 나중에 나타나도(데이터를 받은 뒤 렌더) 잰다.
 *  step 단위로 내림해 창 크기를 조금 바꿀 때마다 다시 그리지 않게 한다 */
export function useWidth<T extends HTMLElement>(step = 1) {
  const [el, setEl] = useState<T | null>(null)
  const [w, setW] = useState(0)
  useEffect(() => {
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width / step) * step))
    ro.observe(el)
    return () => ro.disconnect()
  }, [el, step])
  return [setEl, w] as const
}
