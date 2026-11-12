import { useEffect, useState } from 'react'
import { useApp } from './Shell'

/** api 함수를 부르고 결과를 돌려준다. 시연 시각이나 저장 내용이 바뀌면 다시 부른다. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []): T | undefined {
  const { snap, version } = useApp()
  const [data, setData] = useState<T>()
  useEffect(() => {
    let alive = true
    fn().then((d) => { if (alive) setData(d) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap, version, ...deps])
  return data
}
