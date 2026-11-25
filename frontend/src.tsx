import React, { useState, useEffect, useRef } from 'react'; import { createRoot } from 'react-dom/client'; import './style.css';
type Slot = { slot_id: number, name: string, specialty: string, day: string, time: string }; type Appointment = { id: number, name: string, phone: string, status: string, day: string, time: string }; type Message = { role: string, text: string };
function App() {
    const [slots, S] = useState<Slot[]>([]), [appointments, A] = useState<Appointment[]>([]), [state, C] = useState('Idle'), [messages, M] = useState<Message[]>([]), [mute, U] = useState(false), [seconds, T] = useState(0), [level, L] = useState(0), [error, E] = useState(''), [day, D] = useState(''); const socket = useRef<WebSocket | null>(null), audio = useRef<AudioContext | null>(null), stream = useRef<MediaStream | null>(null), capture = useRef<{ source: MediaStreamAudioSourceNode, processor: ScriptProcessorNode, gain: GainNode } | null>(null), nodes = useRef<AudioBufferSourceNode[]>([]), next = useRef(0), muted = useRef(false), generation = useRef(0), bottom = useRef<HTMLDivElement>(null);
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
                        A(d.appointments);
                    }
                } catch (err) {
                    console.error('Dashboard message error:', err);
                }
            }; ws.onclose = () => { if (!stopped) timer = setTimeout(connect, 1000) }
        } connect(); return () => { stopped = true; clearTimeout(timer); ws.close() }
    }, []); useEffect(() => { if (state !== 'Connected') return; const i = setInterval(() => T(s => s + 1), 1000); return () => clearInterval(i) }, [state]);
    useEffect(() => {
        bottom.current?.scrollIntoView({
            behavior: 'smooth',
            block: 'nearest'
        });
    }, [messages]);
    function silence() { for (const n of nodes.current) { try { n.stop() } catch { } } nodes.current = []; next.current = 0 }
    function end() { generation.current++; socket.current?.close(); socket.current = null; if (capture.current) { try { capture.current.processor.onaudioprocess = null; capture.current.source.disconnect(); capture.current.processor.disconnect(); capture.current.gain.disconnect() } catch { } capture.current = null } stream.current?.getTracks().forEach(t => t.stop()); stream.current = null; silence(); audio.current?.close(); audio.current = null; C('Ended'); L(0) }
    async function start() {
        if (socket.current) return; const g = ++generation.current; E(''); M([]); T(0); U(false); muted.current = false; C('Connecting'); try {
            const ctx = new AudioContext(); audio.current = ctx; await ctx.resume(); const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } }); if (g !== generation.current) { mic.getTracks().forEach(t => t.stop()); return } stream.current = mic; const ws = new WebSocket('ws://127.0.0.1:8765'); socket.current = ws; ws.binaryType = 'arraybuffer'; const source = ctx.createMediaStreamSource(mic), processor = ctx.createScriptProcessor(2048, 1, 1), gain = ctx.createGain(); gain.gain.value = 0; source.connect(processor); processor.connect(gain); gain.connect(ctx.destination); capture.current = { source, processor, gain }; processor.onaudioprocess = e => { if (ws.readyState !== 1) return; const input = e.inputBuffer.getChannelData(0), ratio = ctx.sampleRate / 16000, count = Math.floor(input.length / ratio), pcm = new Int16Array(count); let peak = 0; for (let i = 0; i < count; i++) { const startIdx = Math.floor(i * ratio), endIdx = Math.max(startIdx + 1, Math.floor((i + 1) * ratio)); let sum = 0; for (let j = startIdx; j < endIdx && j < input.length; j++) { const v = muted.current ? 0 : input[j]; sum += v; peak = Math.max(peak, Math.abs(v)) } const avg = sum / (endIdx - startIdx); pcm[i] = Math.max(-32768, Math.min(32767, avg * 32767)) } L(peak); ws.send(pcm.buffer) }; ws.onmessage = e => {
                if (g !== generation.current) return; if (typeof e.data === 'string') {
                    const x = JSON.parse(e.data); if (x.type === 'ready') C('Connected'); if (x.type === 'dashboard') {
                        if (Array.isArray(x.slots)) {
                            S(x.slots);
                        }

                        if (Array.isArray(x.appointments)) {
                            A(x.appointments);
                        }
                    } if (x.type === 'error') { E(x.text); end() } if (x.type === 'interrupt') silence(); if (x.type === 'transcript') M(prev => { const last = prev[prev.length - 1]; return x.role === 'assistant' && last?.role === 'assistant' ? [...prev.slice(0, -1), { role: x.role, text: last.text + x.text }] : [...prev, { role: x.role, text: x.text }] }); return
                } if (e.data.byteLength < 2) return; if (ctx.state === 'suspended') void ctx.resume(); const samples = new Int16Array(e.data.slice(0, e.data.byteLength - (e.data.byteLength % 2))), buf = ctx.createBuffer(1, samples.length, 24000), out = buf.getChannelData(0); for (let i = 0; i < samples.length; i++)out[i] = samples[i] / 32768; const n = ctx.createBufferSource(); n.buffer = buf; n.connect(ctx.destination); next.current = Math.max(ctx.currentTime + .03, next.current); n.start(next.current); next.current += buf.duration; nodes.current.push(n); n.onended = () => { nodes.current = nodes.current.filter(x => x !== n) }
            }; ws.onerror = () => { E('Could not connect to voice server.'); end() }; ws.onclose = () => { if (g === generation.current) end() }
        } catch (e) { E(String(e)); end() }
    }
    const days = [...new Set(slots.map(x => x.day))], selected = day || days[0], doctors = [...new Set(slots.map(x => x.name))]; const active = state === 'Connected' || state === 'Connecting'; return <div className="shell"><aside><div className="brand"><span>✚</span> careline<span className="dot">.</span></div><div className="small">WORKSPACE</div><nav><a className="chosen" href="#overview">▦ &nbsp; Overview</a><a href="#doctors">＋ &nbsp; Doctors</a><a href="#appointments">▤ &nbsp; Appointments</a></nav><div className="foot">● &nbsp; Demo clinic<br /><small>Fictional patient data only</small></div></aside><main id="overview"><header><div><div className="eyebrow">CLINIC OPERATIONS / SCHEDULING</div><h1>Appointment desk</h1><p>Manage availability and voice-assisted bookings.</p></div><button onClick={start} disabled={active}>☎ &nbsp; Try voice call</button></header>{error && <div className="error">{error}</div>}<section className="metrics"><article><label>Available doctors</label><strong>{doctors.length.toString().padStart(2, '0')}</strong><small>Across all specialties</small></article><article><label>Open slots</label><strong>{slots.length}</strong><small>Next seven days</small></article><article><label>Confirmed bookings</label><strong>{appointments.filter(x => x.status === 'booked').length}</strong><small>All scheduled appointments</small></article></section><div className="workspace"><div><section className="panel" id="doctors"><div className="panelhead"><h2>Doctor availability</h2><select value={selected || ''} onChange={e => D(e.target.value)}>{days.map(d => <option key={d}>{d}</option>)}</select></div>{doctors.map((name, i) => <div className="doctor" key={name}><div className={'avatar a' + i}>{name.split(' ').slice(1).map(n => n[0]).join('')}</div><div><b>{name}</b><small>{slots.find(s => s.name === name)?.specialty}</small><div className="chips">{slots.filter(s => s.name === name && s.day === selected).map(s => <span key={s.slot_id}>{s.time}</span>)}</div></div></div>)}</section><section className="panel" id="appointments"><div className="panelhead"><h2>Appointments</h2><span className="live">● Live updates</span></div><div className="table"><table><thead><tr><th>Doctor / patient</th><th>Schedule</th><th>Status</th></tr></thead><tbody>{appointments.map(a => <tr key={a.id}><td>{a.name}<small>{a.phone}</small></td><td>{a.day}<small>{a.time}</small></td><td><span className={'status ' + a.status}>{a.status}</span></td></tr>)}</tbody></table>{!appointments.length && <p className="empty">No appointments yet. Start a voice call to book one.</p>}</div></section></div><section className="phone"><div className="notch" /><div className="phonehead"><div className="orb">✳</div><h2>Careline assistant</h2><span className="callstate">{state} {state === 'Connected' && `· ${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`}</span></div><div className="wave">{Array.from({ length: 23 }, (_, i) => <i key={i} style={{ height: 5 + level * 90 * (.3 + Math.abs(Math.sin(i * 1.7))) }} />)}</div><div className="transcript"><label>LIVE TRANSCRIPT</label>{messages.length === 0 && <p>Conversation will appear here when you connect.</p>}{messages.map((m, i) => <div key={i} className={'message ' + m.role}><small>{m.role === 'caller' ? 'You' : 'Careline'}</small>{m.text}</div>)}<div ref={bottom} /></div><div className="controls"><button className="secondary" disabled={!active} onClick={() => { muted.current = !muted.current; U(muted.current) }}>{mute ? 'Unmute' : 'Mute'}</button><button className={active ? 'hang' : ''} onClick={active ? end : start}>{active ? 'End call' : 'Start call'}</button></div></section></div><footer>CARELINE / SCHEDULING STUDIO <span>Demo environment · Not for clinical use</span></footer></main></div>
}
createRoot(document.getElementById('root')!).render(<App />);
