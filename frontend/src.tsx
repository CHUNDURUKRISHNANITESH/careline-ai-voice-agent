import React, { useState, useEffect, useRef } from 'react'; import { createRoot } from 'react-dom/client'; import './style.css';
type Slot = { slot_id: number, name: string, specialty: string, day: string, time: string }; type Appointment = { id: number, slot_id?: number, name: string, specialty?: string, phone: string, status: string, day: string, time: string }; type Message = { role: string, text: string };
function App() {
    const [slots, S] = useState<Slot[]>([]), [appointments, A] = useState<Appointment[]>([]), [state, C] = useState('Idle'), [messages, M] = useState<Message[]>([]), [mute, U] = useState(false), [seconds, T] = useState(0), [level, L] = useState(0), [thinking, K] = useState(false), [latestBooked, B] = useState<Appointment | null>(null), [selectedApptId, P] = useState<number | null>(null), [highlighted, H] = useState<Record<number, 'booked' | 'cancelled'>>({}), [error, E] = useState(''), [day, D] = useState(''); const socket = useRef<WebSocket | null>(null), audio = useRef<AudioContext | null>(null), stream = useRef<MediaStream | null>(null), capture = useRef<{ source: MediaStreamAudioSourceNode, processor: ScriptProcessorNode, gain: GainNode } | null>(null), nodes = useRef<AudioBufferSourceNode[]>([]), next = useRef(0), muted = useRef(false), generation = useRef(0), seenBooked = useRef<Set<number>>(new Set()), prevStatus = useRef<Record<number, string>>({}), stateRef = useRef('Idle'), bottom = useRef<HTMLDivElement>(null);
    stateRef.current = state;
    function flashRow(id: number, kind: 'booked' | 'cancelled') {
        H(prev => ({ ...prev, [id]: kind }));
        setTimeout(() => H(prev => { const copy = { ...prev }; delete copy[id]; return copy; }), 2400);
    }
    function playTone(kind: 'ring' | 'connect' | 'end') {
        try {
            const c = audio.current ?? new AudioContext();
            const beep = (freq: number, delay: number, dur: number) => {
                const o = c.createOscillator(), g = c.createGain();
                o.type = 'sine'; o.frequency.value = freq;
                g.gain.setValueAtTime(0.0001, c.currentTime + delay);
                g.gain.exponentialRampToValueAtTime(0.035, c.currentTime + delay + 0.015);
                g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + delay + dur);
                o.connect(g); g.connect(c.destination);
                o.start(c.currentTime + delay); o.stop(c.currentTime + delay + dur + 0.02);
            };
            if (kind === 'ring') { beep(440, 0, 0.18); beep(480, 0.22, 0.18); }
            else if (kind === 'connect') { beep(523.25, 0, 0.09); beep(659.25, 0.1, 0.14); }
            else { beep(480, 0, 0.1); beep(340, 0.11, 0.16); }
            if (!audio.current) setTimeout(() => { void c.close(); }, 600);
        } catch { }
    }
    function syncAppointments(rows: Appointment[]) {
        A(rows);
        let newestBooked: Appointment | null = null;
        for (const row of rows) {
            const old = prevStatus.current[row.id];
            if (row.status === 'booked' && !seenBooked.current.has(row.id)) {
                seenBooked.current.add(row.id);
                flashRow(row.id, 'booked');
                if (!newestBooked || row.id > newestBooked.id) newestBooked = row;
            } else if (old === 'booked' && row.status === 'cancelled') {
                flashRow(row.id, 'cancelled');
            }
            prevStatus.current[row.id] = row.status;
        }
        B(prev => {
            if (newestBooked && (!prev || newestBooked.id >= prev.id)) return newestBooked;
            if (!prev) return null;
            const live = rows.find(r => r.id === prev.id);
            return live && live.status === 'booked' ? live : (rows.find(r => r.status === 'booked') ?? null);
        });
    }
    function refresh() { } // Dashboard receives snapshots through its own socket.
    useEffect(() => {
        let ws: WebSocket; let timer: ReturnType<typeof setTimeout>; let stopped = false; function connect() {
            ws = new WebSocket('ws://127.0.0.1:8766');
            ws.onmessage = e => {
                try {
                    const d = JSON.parse(e.data);

                    if (Array.isArray(d.slots)) {
                        S(d.slots);
                    }

                    if (Array.isArray(d.appointments)) {
                        syncAppointments(d.appointments);
                    }
                } catch (err) {
                    console.error('Dashboard message error:', err);
                }
            }; ws.onclose = () => { if (!stopped) timer = setTimeout(connect, 1000) }
        } connect(); return () => { stopped = true; clearTimeout(timer); ws.close() }
    }, []); useEffect(() => { if (state !== 'Connected') return; const i = setInterval(() => T(s => s + 1), 1000); return () => clearInterval(i) }, [state]);
    useEffect(() => { if (state !== 'Connecting') return; playTone('ring'); const i = setInterval(() => playTone('ring'), 1800); return () => clearInterval(i) }, [state]);
    useEffect(() => {
        bottom.current?.scrollIntoView({
            behavior: 'smooth',
            block: 'nearest'
        });
    }, [messages]);
    function silence() { for (const n of nodes.current) { try { n.stop() } catch { } } nodes.current = []; next.current = 0 }
    function end() { const wasActive = stateRef.current === 'Connected' || stateRef.current === 'Connecting'; generation.current++; socket.current?.close(); socket.current = null; if (capture.current) { try { capture.current.processor.onaudioprocess = null; capture.current.source.disconnect(); capture.current.processor.disconnect(); capture.current.gain.disconnect() } catch { } capture.current = null } stream.current?.getTracks().forEach(t => t.stop()); stream.current = null; silence(); audio.current?.close(); audio.current = null; if (wasActive) playTone('end'); K(false); C('Ended'); L(0) }
    async function start() {
        if (socket.current) return; const g = ++generation.current; E(''); M([]); T(0); U(false); K(false); muted.current = false; C('Connecting'); try {
            const ctx = new AudioContext(); audio.current = ctx; await ctx.resume(); const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } }); if (g !== generation.current) { mic.getTracks().forEach(t => t.stop()); return } stream.current = mic; const ws = new WebSocket('ws://127.0.0.1:8765'); socket.current = ws; ws.binaryType = 'arraybuffer'; const source = ctx.createMediaStreamSource(mic), processor = ctx.createScriptProcessor(2048, 1, 1), gain = ctx.createGain(); gain.gain.value = 0; source.connect(processor); processor.connect(gain); gain.connect(ctx.destination); capture.current = { source, processor, gain }; processor.onaudioprocess = e => { if (ws.readyState !== 1) return; const input = e.inputBuffer.getChannelData(0), ratio = ctx.sampleRate / 16000, count = Math.floor(input.length / ratio), pcm = new Int16Array(count); let peak = 0; for (let i = 0; i < count; i++) { const startIdx = Math.floor(i * ratio), endIdx = Math.max(startIdx + 1, Math.floor((i + 1) * ratio)); let sum = 0; for (let j = startIdx; j < endIdx && j < input.length; j++) { const v = muted.current ? 0 : input[j]; sum += v; peak = Math.max(peak, Math.abs(v)) } const avg = sum / (endIdx - startIdx); pcm[i] = Math.max(-32768, Math.min(32767, avg * 32767)) } L(peak); ws.send(pcm.buffer) }; ws.onmessage = e => {
                if (g !== generation.current) return; if (typeof e.data === 'string') {
                    const x = JSON.parse(e.data); if (x.type === 'ready') { playTone('connect'); C('Connected') } if (x.type === 'dashboard') {
                        if (Array.isArray(x.slots)) {
                            S(x.slots);
                        }

                        if (Array.isArray(x.appointments)) {
                            syncAppointments(x.appointments);
                        }
                    } if (x.type === 'booked' && x.appointment) { seenBooked.current.add(x.appointment.id); flashRow(x.appointment.id, 'booked'); B(prev => (!prev || x.appointment.id >= prev.id ? x.appointment : prev)) } if (x.type === 'thinking') K(Boolean(x.active)); if (x.type === 'error') { K(false); E(x.text); end() } if (x.type === 'interrupt') { K(false); silence() } if (x.type === 'transcript') M(prev => { const last = prev[prev.length - 1]; return x.role === 'assistant' && last?.role === 'assistant' ? [...prev.slice(0, -1), { role: x.role, text: last.text + x.text }] : [...prev, { role: x.role, text: x.text }] }); return
                } if (e.data.byteLength < 2) return; if (ctx.state === 'suspended') void ctx.resume(); const samples = new Int16Array(e.data.slice(0, e.data.byteLength - (e.data.byteLength % 2))), buf = ctx.createBuffer(1, samples.length, 24000), out = buf.getChannelData(0); for (let i = 0; i < samples.length; i++)out[i] = samples[i] / 32768; const n = ctx.createBufferSource(); n.buffer = buf; n.connect(ctx.destination); next.current = Math.max(ctx.currentTime + .03, next.current); n.start(next.current); next.current += buf.duration; nodes.current.push(n); n.onended = () => { nodes.current = nodes.current.filter(x => x !== n) }
            }; ws.onerror = () => { E('Could not connect to voice server.'); end() }; ws.onclose = () => { if (g === generation.current) end() }
        } catch (e) { E(String(e)); end() }
    }
    const days = [...new Set(slots.map(x => x.day))], selected = day || days[0], doctors = [...new Set(slots.map(x => x.name))]; const active = state === 'Connected' || state === 'Connecting'; const selectedAppt = selectedApptId !== null ? (appointments.find(a => a.id === selectedApptId) ?? (latestBooked?.id === selectedApptId ? latestBooked : null)) : null; return <div className="shell"><aside><div className="brand"><span>✚</span> careline<span className="dot">.</span></div><div className="small">WORKSPACE</div><nav><a className="chosen" href="#overview">▦ &nbsp; Overview</a><a href="#doctors">＋ &nbsp; Doctors</a><a href="#appointments">▤ &nbsp; Appointments</a></nav></aside><main id="overview"><header><div><div className="eyebrow">CLINIC OPERATIONS / SCHEDULING</div><h1>Appointment desk</h1><p>Manage availability and voice-assisted bookings.</p></div><button onClick={start} disabled={active}>☎ &nbsp; Try voice call</button></header>{error && <div className="error">{error}</div>}{latestBooked && <div className="booked-banner"><div><b>Appointment booked (#{latestBooked.id})</b> · {latestBooked.name} on {latestBooked.day} at {latestBooked.time}</div><div className="booked-banner-actions"><button onClick={() => P(latestBooked.id)}>View details</button><button className="icon-btn" aria-label="Dismiss" onClick={() => B(null)}>×</button></div></div>}<section className="metrics"><article><label>Available doctors</label><strong>{doctors.length.toString().padStart(2, '0')}</strong><small>Across all specialties</small></article><article><label>Open slots</label><strong>{slots.length}</strong><small>Next seven days</small></article><article><label>Confirmed bookings</label><strong>{appointments.filter(x => x.status === 'booked').length}</strong><small>All scheduled appointments</small></article></section><div className="workspace"><div><section className="panel" id="doctors"><div className="panelhead"><h2>Doctor availability</h2><select value={selected || ''} onChange={e => D(e.target.value)}>{days.map(d => <option key={d}>{d}</option>)}</select></div>{doctors.map((name, i) => <div className="doctor" key={name}><div className={'avatar a' + i}>{name.split(' ').slice(1).map(n => n[0]).join('')}</div><div><b>{name}</b><small>{slots.find(s => s.name === name)?.specialty}</small><div className="chips">{slots.filter(s => s.name === name && s.day === selected).map(s => <span key={s.slot_id}>{s.time}</span>)}</div></div></div>)}</section><section className="panel" id="appointments"><div className="panelhead"><h2>Appointments</h2><span className="live">● Live updates</span></div><div className="table"><table><thead><tr><th>Doctor / patient</th><th>Schedule</th><th>Status</th><th></th></tr></thead><tbody>{appointments.map(a => <tr key={a.id} className={highlighted[a.id] ? 'row-' + highlighted[a.id] : ''}><td>{a.name}<small>{a.phone}</small></td><td>{a.day}<small>{a.time}</small></td><td><span className={'status ' + a.status}>{a.status}</span></td><td><button className="detail-btn" onClick={() => P(a.id)}>Details</button></td></tr>)}</tbody></table>{!appointments.length && <p className="empty">No appointments yet. Start a voice call to book one.</p>}</div></section></div><section className="phone"><div className="notch" /><div className="phonehead"><div className={'orb' + (state === 'Connecting' ? ' ringing' : state === 'Connected' ? ' live' : '')}>✳</div><h2>Careline assistant</h2><span className="callstate">{state === 'Connecting' ? 'Ringing...' : state} {state === 'Connected' && `· ${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`}</span></div><div className="wave">{Array.from({ length: 23 }, (_, i) => <i key={i} style={{ height: 5 + level * 90 * (.3 + Math.abs(Math.sin(i * 1.7))) }} />)}</div><div className="transcript"><label>LIVE TRANSCRIPT</label>{messages.length === 0 && <p>Conversation will appear here when you connect.</p>}{messages.map((m, i) => <div key={i} className={'message ' + m.role}><small>{m.role === 'caller' ? 'You' : 'Careline'}</small>{m.text}</div>)}<div ref={bottom} /></div>{latestBooked && <div className="phone-confirm"><div><b>Confirmed #{latestBooked.id}</b><small>{latestBooked.name} · {latestBooked.day} {latestBooked.time}</small></div><button onClick={() => P(latestBooked.id)}>Details</button></div>}{thinking && <div className="thinking-bar" role="status" aria-live="polite"><span className="spinner" /><span>Careline is thinking...</span></div>}<div className="controls"><button className="secondary" disabled={!active} onClick={() => { muted.current = !muted.current; U(muted.current) }}>{mute ? 'Unmute' : 'Mute'}</button><button className={active ? 'hang' : ''} onClick={active ? end : start}>{active ? 'End call' : 'Start call'}</button></div></section></div>{selectedAppt && <div className="modal-backdrop" onClick={() => P(null)}><div className="modal" onClick={e => e.stopPropagation()}><div className="modal-head"><h2>Appointment #{selectedAppt.id}</h2><button className="icon-btn" aria-label="Close" onClick={() => P(null)}>×</button></div><div className="detail-grid"><div className="detail-row"><span>Doctor</span><b>{selectedAppt.name}</b></div>{selectedAppt.specialty && <div className="detail-row"><span>Specialty</span><b>{selectedAppt.specialty}</b></div>}<div className="detail-row"><span>Date</span><b>{selectedAppt.day}</b></div><div className="detail-row"><span>Time</span><b>{selectedAppt.time}</b></div><div className="detail-row"><span>Phone</span><b>{selectedAppt.phone}</b></div><div className="detail-row"><span>Status</span><span className={'status ' + selectedAppt.status}>{selectedAppt.status}</span></div></div><button onClick={() => P(null)}>Close</button></div></div>}</main></div>
}
createRoot(document.getElementById('root')!).render(<App />);
