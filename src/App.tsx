import { useMemo, useState } from 'react';
import { AppLayout, Chip, useLocalStorage, type Meta } from './ui';
import { ask, hasKey } from './lib/ai';

/* ──────────────────────────────────────────────────────────────────────────
 * 💊영양제 알리미💊  (보드 17번)
 * 영양제 등록(복용 시간대) → 시간대별 복용 스케줄 → 오늘 복용 체크 + 함께 먹을 때 주의.
 * ※ 일반 정보 제공용이며 의학적 조언이 아닙니다. 복용은 전문가와 상담하세요.
 * ────────────────────────────────────────────────────────────────────────── */
const M: Meta = {
  id: 26, icon: '💊', title: '영양제 알리미', tagline: '먹는 영양제를 등록하면 시간대별 스케줄로 정리하고, 오늘 복용을 체크하며 함께 먹을 때 주의를 알려주는 앱',
  members: ['모집 중'], color: '#16a34a', ai: true, note: '보드 17번',
  problem:
    '영양제를 여러 개 챙기다 보면 언제 무엇을 먹었는지 헷갈리고, 같이 먹으면 흡수를 방해하는 조합도 놓치기 쉽습니다. ' +
    '이 앱은 복용 중인 영양제를 시간대별로 정리해 오늘 먹을 것을 체크하게 하고, 함께 복용 시 주의할 조합을 알려줘 ' +
    '꾸준하고 안전한 복용 습관을 돕습니다.',
  features: [
    { icon: '➕', title: '영양제 등록', desc: '이름과 복용 시간대(아침·점심·저녁·취침) 지정' },
    { icon: '🕒', title: '시간대 스케줄', desc: '시간대별로 먹을 영양제를 묶어 표시' },
    { icon: '✅', title: '오늘 복용 체크', desc: '먹은 것을 체크해 복용률을 관리' },
    { icon: '⚠️', title: '조합 주의', desc: '함께 먹으면 흡수를 방해하는 조합 안내' },
    { icon: '🤖', title: 'AI 복용 팁', desc: '(선택) 등록한 영양제의 권장 복용 시점 안내' },
  ],
  howto: ['먹는 영양제 이름과 복용 시간대를 등록합니다', '시간대별 스케줄에서 오늘 먹은 것을 체크하세요', '조합 주의와 AI 팁으로 복용 시점을 최적화하세요'],
  facts: [
    { value: '시간대별', label: '복용 스케줄' },
    { value: '복용률', label: '오늘 체크' },
    { value: '조합 주의', label: '흡수 방해' },
    { value: '저장', label: '내 영양제' },
  ],
  info: [
    { title: '복용 시점이 중요', body: '지용성(비타민 A·D·E·K)은 식후에, 철분은 공복+비타민C와, 마그네슘은 취침 전이 좋은 식입니다. 시점만 맞춰도 흡수가 달라집니다.' },
    { title: '함께 먹을 때 주의', body: '칼슘과 철분, 칼슘과 마그네슘 고용량은 흡수를 서로 방해할 수 있어 시간차 복용이 권장됩니다. 본 안내는 일반 정보이며 약 복용 중이면 전문가와 상담하세요.' },
  ],
  stack: ['React 18', 'TypeScript', 'Vite', 'localStorage', 'OpenAI(선택)'],
};

const SLOTS = ['아침', '점심', '저녁', '취침'] as const;
type Slot = typeof SLOTS[number];
interface Supp { id: number; name: string; slots: Slot[]; }
// 같이 먹을 때 주의 조합(키워드 기준)
const CONFLICTS: [string, string, string][] = [
  ['칼슘', '철분', '칼슘과 철분은 흡수를 방해 — 시간차 복용 권장'],
  ['칼슘', '마그네슘', '고용량 칼슘·마그네슘은 함께보다 나눠서'],
  ['아연', '철분', '아연과 철분은 흡수 경쟁 — 시간차 권장'],
];

const App = () => {
  const [supps, setSupps] = useLocalStorage<Supp[]>('na_supps', [
    { id: 1, name: '비타민D', slots: ['아침'] }, { id: 2, name: '마그네슘', slots: ['취침'] },
  ]);
  const [taken, setTaken] = useLocalStorage<Record<string, boolean>>('na_taken', {});
  const [name, setName] = useState(''); const [slots, setSlots] = useState<Slot[]>(['아침']);
  const [seq, setSeq] = useState(3);
  const [ai, setAi] = useState(''); const [aiBusy, setAiBusy] = useState(false);

  const add = () => {
    if (!name.trim() || slots.length === 0) return;
    setSupps([...supps, { id: seq, name: name.trim(), slots: [...slots] }]); setSeq((s) => s + 1); setName('');
  };
  const remove = (id: number) => setSupps(supps.filter((s) => s.id !== id));
  const toggleSlot = (s: Slot) => setSlots(slots.includes(s) ? slots.filter((x) => x !== s) : [...slots, s]);

  const total = supps.reduce((a, s) => a + s.slots.length, 0);
  const takenCount = supps.reduce((a, s) => a + s.slots.filter((sl) => taken[`${s.id}:${sl}`]).length, 0);

  const warnings = useMemo(() => {
    const names = supps.map((s) => s.name);
    return CONFLICTS.filter(([a, b]) => names.some((n) => n.includes(a)) && names.some((n) => n.includes(b))).map(([, , msg]) => msg);
  }, [supps]);

  const tip = async () => {
    setAiBusy(true); setAi('');
    try {
      const out = await ask(
        '너는 영양제 복용 가이드다. 등록된 영양제 목록에 대해 각 영양제의 권장 복용 시점(식전/식후/취침 등)과 함께 먹을 때 주의를 한국어로 간단히. 의학적 단정은 피하고 일반 정보 톤. 6줄 이내.',
        `영양제: ${supps.map((s) => s.name).join(', ')}`, { temperature: 0.5, max_tokens: 350 });
      setAi(out);
    } catch { setAi('AI 팁을 쓰려면 위에서 OpenAI 키를 입력하세요. (키 없이도 스케줄·체크·조합 주의는 동작합니다.)'); }
    finally { setAiBusy(false); }
  };

  const feature = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div className="card">
        <div className="seclabel" style={{ color: M.color }}>➕ 영양제 등록</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 오메가3, 비타민C" style={{ flex: 1 }} />
          <button className="btn" style={{ background: M.color }} onClick={add}>추가</button>
        </div>
        <div className="chips" style={{ marginTop: 10 }}>{SLOTS.map((s) => <Chip key={s} active={slots.includes(s)} color={M.color} onClick={() => toggleSlot(s)}>{s}</Chip>)}</div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="seclabel" style={{ color: M.color }}>🕒 오늘 복용 ({takenCount}/{total})</div>
          {takenCount > 0 && <button className="btn btn-ghost" style={{ padding: '4px 12px', fontSize: 12 }} onClick={() => setTaken({})}>초기화</button>}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
          {SLOTS.map((slot) => {
            const list = supps.filter((s) => s.slots.includes(slot));
            if (list.length === 0) return null;
            return (
              <div key={slot}>
                <div style={{ fontSize: 12, fontWeight: 800, color: M.color, marginBottom: 6 }}>{slot}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {list.map((s) => {
                    const k = `${s.id}:${slot}`, on = !!taken[k];
                    return (
                      <span key={k} className="box" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 12px', background: on ? '#dcfce7' : undefined }}>
                        <button onClick={() => setTaken({ ...taken, [k]: !on })} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 15 }}>{on ? '✅' : '⬜'}</button>
                        <span style={{ fontSize: 13.5, textDecoration: on ? 'line-through' : 'none' }}>{s.name}</span>
                        <button onClick={() => remove(s.id)} title="삭제" style={{ border: 'none', background: 'none', color: '#ef4444', cursor: 'pointer', fontWeight: 800 }}>×</button>
                      </span>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {total === 0 && <p style={{ fontSize: 14, color: 'var(--sub)' }}>위에서 영양제를 등록해 보세요.</p>}
        </div>
        {warnings.length > 0 && (
          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {warnings.map((w, i) => <span key={i} style={{ fontSize: 12.5, fontWeight: 600, padding: '6px 10px', borderRadius: 8, background: '#fef9c3', color: '#854d0e' }}>⚠️ {w}</span>)}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: M.color }}>🤖 AI 복용 팁</span>
          <button className="btn btn-ghost" style={{ padding: '8px 14px', fontSize: 13 }} disabled={aiBusy} onClick={tip}>{aiBusy ? '생성 중…' : hasKey() ? '팁 받기' : '팁 받기'}</button>
        </div>
        {ai && <p style={{ whiteSpace: 'pre-wrap', fontSize: 14, lineHeight: 1.8, marginTop: 12 }}>{ai}</p>}
      </div>
    </div>
  );

  return <AppLayout m={M} feature={feature} />;
};

export default App;
