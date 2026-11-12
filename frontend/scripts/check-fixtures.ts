// 백엔드 fixture가 API 계약과 화면 규칙에 맞는지 검사하고, 화면에 어떻게 보일지 장면별로 출력한다.
// 사용: npm run check:fixtures [-- fixture.json]   (기본: src/api/fixtures/v1.1-demo.json, Node 22.6 이상)
// fixture 객체 순서를 재생 순서로 본다. 문제가 있으면 목록을 출력하고 종료 코드 1로 끝난다.
import { readFileSync } from 'node:fs'
import type { Board, Card, IncidentDetail } from '../src/api/contract.ts'
import { describeCard, hhmm, replayLabel, toChecks, toEvidence, toInvestigation } from '../src/api/adapt.ts'

type Scene = { board: Board; incident?: IncidentDetail }
const file = process.argv[2] ?? 'src/api/fixtures/v1.1-demo.json'
const scenes = Object.entries(JSON.parse(readFileSync(file, 'utf8')) as Record<string, Scene>)
const problems: string[] = []
const bad = (where: string, msg: string) => problems.push(`[${where}] ${msg}`)
const HAS_OFFSET = /(Z|[+-]\d\d:\d\d)$/

/** 객체 안의 모든 시각 문자열(키 이름이 At/at/asOf/since로 끝나는 값)이 오프셋을 가졌는지 */
function checkTimes(where: string, v: unknown, path = ''): void {
  if (Array.isArray(v)) return v.forEach((x, i) => checkTimes(where, x, `${path}[${i}]`))
  if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      if (typeof x === 'string' && /(At|^at|asOf|since)$/.test(k) && !HAS_OFFSET.test(x)) bad(where, `${path}.${k} 시각에 오프셋이 없어요: ${x}`)
      else checkTimes(where, x, `${path}.${k}`)
    }
  }
}

let prev: { name: string; board: Board } | null = null
const lastGrade = new Map<string, { grade: number; scene: string; step: number | null }>()

for (const [name, { board, incident }] of scenes) {
  const tz = board.displayTimeZone
  const cards: Card[] = [...board.emergency, ...board.warning]
  checkTimes(name, board)
  if (incident) checkTimes(name, incident)

  // 요약 숫자와 목록 길이
  const s = board.summary
  if (s.emergencyCount !== board.emergency.length) bad(name, `emergencyCount ${s.emergencyCount} ≠ 비상 카드 ${board.emergency.length}`)
  if (s.warningCount !== board.warning.length) bad(name, `warningCount ${s.warningCount} ≠ 예고 카드 ${board.warning.length}`)
  if (s.normalCount !== board.normal.length) bad(name, `normalCount ${s.normalCount} ≠ 정상 ${board.normal.length}`)
  for (const [list, label] of [[board.emergency, '비상'], [board.warning, '예고']] as const) {
    list.forEach((c, i) => { if (c.rank !== i + 1) bad(name, `${label} ${i + 1}번째 카드 rank가 ${c.rank}`) })
  }

  // 재생 순서: step은 그대로거나 1 증가, 같은 step이면 snapshotVersion만 증가
  if (prev && board.replay && prev.board.replay) {
    const d = board.replay.step - prev.board.replay.step
    if (d < 0) bad(name, `replay.step이 줄었어요 (${prev.board.replay.step} → ${board.replay.step})`)
    if (board.snapshotVersion <= prev.board.snapshotVersion) bad(name, `snapshotVersion이 그대로거나 줄었어요 (${prev.board.snapshotVersion} → ${board.snapshotVersion})`)
    if (d === 0 && board.replay.currentAt !== prev.board.replay.currentAt) bad(name, '같은 step인데 재생 시각이 달라요')
  }

  for (const c of cards) {
    const where = `${name} ${c.equipment.no}`
    // previousGrade: 앞 장면과 등급이 다르면 null이 아니어야 하고, 바로 다음 장면이면 앞 등급과 같아야 한다
    // (fixture 사이에 빠진 장면이 있으면 그 사이에 등급이 또 바뀌었을 수 있어 값까지는 비교하지 않는다)
    const before = lastGrade.get(c.incidentId)
    if (before && before.grade !== c.grade) {
      const next = before.step != null && board.replay != null && board.replay.step - before.step <= 1
      if (c.previousGrade == null) bad(where, `${before.scene}에서 ${before.grade}등급 → 지금 ${c.grade}등급인데 previousGrade가 null`)
      else if (next && c.previousGrade !== before.grade) bad(where, `바로 앞 장면 ${before.grade}등급인데 previousGrade가 ${c.previousGrade}`)
    }
    lastGrade.set(c.incidentId, { grade: c.grade, scene: name, step: board.replay?.step ?? null })
    // 조사 완료면 결과가 연결된 판단 버전 = 카드 revision
    if (c.investigation?.status === 'completed' && c.investigation.judgmentRevision !== c.revision) {
      bad(where, `조사 완료 judgmentRevision ${c.investigation.judgmentRevision} ≠ 카드 revision ${c.revision}`)
    }
    if (c.firstCheck.source === 'investigation' && c.firstCheck.evidenceIds.length === 0) bad(where, '구체화된 firstCheck에 evidenceIds가 없어요')
    if (c.firstCheck.source === 'investigation' && c.investigation?.status !== 'completed') bad(where, '조사 완료 전인데 firstCheck가 구체화돼 있어요')
  }

  if (incident) {
    const where = `${name} 상세 ${incident.equipment.no}`
    const card = cards.find((c) => c.incidentId === incident.incidentId)
    if (!card) bad(where, '목록에 없는 사건이에요')
    else if (card.revision !== incident.judgment.revision) bad(where, `카드 revision ${card.revision} ≠ 상세 judgment ${incident.judgment.revision}`)
    const ids = new Set(incident.evidence.map((e) => e.id))
    if (ids.size !== incident.evidence.length) bad(where, '근거 ID가 중복돼요')
    const refs = [...incident.checklist.flatMap((c) => c.evidenceIds), ...(card?.firstCheck.evidenceIds ?? [])]
    for (const r of refs) if (!ids.has(r)) bad(where, `점검 안내가 가리키는 근거 ${r}가 상세 evidence에 없어요`)
    for (const c of incident.checklist) if (c.source === 'investigation' && c.evidenceIds.length === 0) bad(where, `구체화된 안내 ${c.code}에 evidenceIds가 없어요`)
    const revs = incident.revisions.map((r) => r.revision)
    if (revs.some((r, i) => i > 0 && r >= revs[i - 1])) bad(where, `revisions가 번호 내림차순이 아니에요: ${revs.join(',')}`)
    // 판단 이력에서 등급·순위·사유가 같은 연속 판이 있으면 화면에 같은 줄이 두 번 보인다
    for (let i = 1; i < incident.revisions.length; i++) {
      const a = incident.revisions[i - 1], b = incident.revisions[i]
      if (a.group === b.group && a.grade === b.grade && a.rank === b.rank && a.reason === b.reason) {
        bad(where, `revision ${b.revision}·${a.revision}이 등급·순위·사유가 같아요 (이력에서 구분할 값 필요)`)
      }
    }
  }

  // 화면에 보일 모습
  console.log(`\n■ ${name} · ${replayLabel(board) ?? hhmm(board.asOf, tz)} · snapshotVersion ${board.snapshotVersion}`)
  for (const c of cards) console.log(`  ${describeCard(c)}`)
  if (incident) {
    const inv = toInvestigation(incident.investigation)
    console.log(`  └ 상세 ${incident.equipment.no}${inv ? ` · ${inv.label}(${inv.trigger})` : ''}`)
    for (const c of toChecks(incident.checklist)) {
      console.log(`     확인: ${c.label}${c.baseline ? `\n           (기본 안내: ${c.baseline})` : ''}${c.zone ? ` [위치 ${c.zone}]` : ''}`)
    }
    for (const e of incident.evidence.map((x) => toEvidence(x, tz))) console.log(`     근거 ${e.at ?? '--:--'} ${e.kind} · ${e.title}${e.interpretation ? ' [Q-First 해석]' : ''}`)
  }
  prev = { name, board }
}

if (problems.length) {
  console.log(`\n문제 ${problems.length}건`)
  for (const p of problems) console.log(`  - ${p}`)
  process.exit(1)
}
console.log('\n문제 없음')
